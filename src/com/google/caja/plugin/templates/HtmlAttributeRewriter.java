// Copyright (C) 2009 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package com.google.caja.plugin.templates;

import com.google.caja.SomethingWidgyHappenedError;
import com.google.caja.lang.css.CssSchema;
import com.google.caja.lang.html.HTML;
import com.google.caja.lang.html.HtmlSchema;
import com.google.caja.lexer.ExternalReference;
import com.google.caja.lexer.FilePosition;
import com.google.caja.lexer.Keyword;
import com.google.caja.lexer.ParseException;
import com.google.caja.lexer.escaping.UriUtil;
import com.google.caja.parser.AncestorChain;
import com.google.caja.parser.ParseTreeNodeVisitor;
import com.google.caja.parser.ParseTreeNode;
import com.google.caja.parser.ParseTreeNodeContainer;
import com.google.caja.parser.css.CssTree;
import com.google.caja.parser.html.Nodes;
import com.google.caja.parser.js.AbstractExpression;
import com.google.caja.parser.js.ArrayConstructor;
import com.google.caja.parser.js.Block;
import com.google.caja.parser.js.Declaration;
import com.google.caja.parser.js.Expression;
import com.google.caja.parser.js.FunctionConstructor;
import com.google.caja.parser.js.Identifier;
import com.google.caja.parser.js.NullLiteral;
import com.google.caja.parser.js.Operation;
import com.google.caja.parser.js.Reference;
import com.google.caja.parser.js.Statement;
import com.google.caja.parser.js.StringLiteral;
import com.google.caja.parser.js.SyntheticNodes;
import com.google.caja.parser.quasiliteral.QuasiBuilder;
import com.google.caja.parser.quasiliteral.ReservedNames;
import com.google.caja.plugin.CssDynamicExpressionRewriter;
import com.google.caja.plugin.CssRewriter;
import com.google.caja.plugin.CssValidator;
import com.google.caja.plugin.JobEnvelope;
import com.google.caja.plugin.PluginMessageType;
import com.google.caja.plugin.PluginMeta;
import com.google.caja.plugin.UriPolicyHintKey;
import com.google.caja.plugin.UriPolicyNanny;
import com.google.caja.plugin.stages.EmbeddedContent;
import com.google.caja.reporting.MessageLevel;
import com.google.caja.reporting.MessagePart;
import com.google.caja.reporting.MessageQueue;
import com.google.caja.util.Lists;
import com.google.caja.util.Maps;
import com.google.caja.util.SyntheticAttributeKey;
import org.w3c.dom.Attr;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Converts attribute values to expressions that produce safe values.
 *
 * @author mikesamuel@gmail.com
 */
public final class HtmlAttributeRewriter {
  private final PluginMeta meta;
  private final CssSchema cssSchema;
  private final HtmlSchema htmlSchema;
  private final MessageQueue mq;
  private final Map<Attr, EmbeddedContent> attributeContent;
  /** Maps handler attribute source to handler names. */
  private final Map<String, String> handlerCache = Maps.newHashMap();
  /** Extracted event handler functions. */
  private final List<EventHandler> handlers = Lists.newArrayList();

  public static final SyntheticAttributeKey<String> HANDLER_NAME
      = new SyntheticAttributeKey<String>(String.class, "handlerName");

  public HtmlAttributeRewriter(
      PluginMeta meta, CssSchema cssSchema, HtmlSchema htmlSchema,
      Map<Attr, EmbeddedContent> attributeContent, MessageQueue mq) {
    this.meta = meta;
    this.cssSchema = cssSchema;
    this.htmlSchema = htmlSchema;
    this.attributeContent = attributeContent;
    this.mq = mq;
  }

  public PluginMeta getPluginMeta() { return meta; }
  public CssSchema getCssSchema() { return cssSchema; }
  public HtmlSchema getHtmlSchema() { return htmlSchema; }
  public List<EventHandler> getHandlers() {
    return Collections.unmodifiableList(handlers);
  }
  public static abstract class AttrValue {
    final JobEnvelope env;
    final Attr src;
    final FilePosition valuePos;
    final HTML.Attribute attrInfo;
    abstract Expression getValueExpr();
    abstract String getPlainValue();
    abstract String getRawValue();

    AttrValue(
        JobEnvelope env, Attr src, FilePosition valuePos, HTML.Attribute attr) {
      this.env = env;
      this.src = src;
      this.valuePos = valuePos;
      this.attrInfo = attr;
    }
  }

  public static AttrValue fromAttr(
      final Attr a, HTML.Attribute attr, JobEnvelope source) {
    FilePosition pos = a.getValue() != null ?
        Nodes.getFilePositionForValue(a) : FilePosition.UNKNOWN;
    return new AttrValue(source, a, pos, attr) {
      @Override
      Expression getValueExpr() {
        return StringLiteral.valueOf(valuePos, getPlainValue());
      }
      @Override
      String getPlainValue() { return a.getValue(); }
      @Override
      String getRawValue() { return Nodes.getRawValue(a); }
    };
  }

  public static final class SanitizedAttr {
    public final boolean isSafe;
    public final Expression result;
    SanitizedAttr(boolean isSafe, Expression result) {
      this.isSafe = isSafe;
      this.result = result;
    }
  }

  public SanitizedAttr sanitizeStringValue(AttrValue attr) {
    Expression dynamicValue = null;
    FilePosition pos = attr.valuePos;
    String value = attr.getPlainValue();
    // There are two cases for name handling.
    // 1. For names that have local scope or names that can't be mangled,
    //    we pass them through unchanged, except we deny the '__' suffix
    //    as reserved for use by the container.
    // 2. For other names, we mangle them by appending a container suffix.
    //    We could allow these names to end with '__', but I think the
    //    inconsistency is more confusing than helpful.
    // Note that this logic matches the logic in domado.js.
    switch (attr.attrInfo.getType()) {
      case CLASSES:
        // className is arbitrary CDATA, it's not restricted by spec,
        // and some js libs depend on putting rich data in className.
        // http://www.w3.org/TR/html401/struct/global.html#adef-class
        // We still ban classNames with words ending '__'.
        // We could try deleting just the bad words, but it seems unlikely
        // that narrow sanitization will allow broken code to still work,
        // and we can revisit this if there are enough cases in the wild.
        if (!checkForbiddenIdList(value, pos)) { return noResult(attr); }
        break;
      case FRAME_TARGET:
        dynamicValue = sanitizeFrameTargetValue(attr);
        break;
      case LOCAL_NAME:
        if (!checkValidId(value, pos)) { return noResult(attr); }
        break;
      case GLOBAL_NAME:
      case ID:
      case IDREF:
        if (!checkValidId(value, pos)) { return noResult(attr); }
        dynamicValue = rewriteIdentifiers(pos, value);
        break;
      case IDREFS:
        if (!checkValidIdList(value, pos)) { return noResult(attr); }
        dynamicValue = rewriteIdentifiers(pos, value);
        break;
      case NONE:
        if (!attr.attrInfo.getValueCriterion().accept(value)) {
          mq.addMessage(
              IhtmlMessageType.BAD_ATTRIB, pos,
              attr.attrInfo.getKey().el, attr.attrInfo.getKey(),
              MessagePart.Factory.valueOf(value));
          return noResult(attr);
        }
        break;
      case SCRIPT:
        String handlerFnName = handlerCache.get(value);
        if (handlerFnName == null) {
          Block b = jsFromAttrib(attr);
          if (b == null || b.children().isEmpty()) { return noResult(attr); }
          rewriteEventHandlerReferences(b);

          handlerFnName = meta.generateUniqueName("c");
          Declaration handler = (Declaration) QuasiBuilder.substV(
              ""
              + "var @handlerName = ___./*@synthetic*/markFuncFreeze("
              + "    /*@synthetic*/function ("
              + "        event, " + ReservedNames.THIS_NODE + ") { @body*; });",
              "handlerName", SyntheticNodes.s(
                  new Identifier(FilePosition.UNKNOWN, handlerFnName)),
              "body", new ParseTreeNodeContainer(b.children()));
          handlers.add(new EventHandler(attr.env, handler));
          handlerCache.put(value, handlerFnName);
        }

        FunctionConstructor eventAdapter
            = (FunctionConstructor) QuasiBuilder.substV(
            ""
            + "(/*@synthetic*/ function (event) {"
            + "  return /*@synthetic*/ (___.plugin_dispatchEvent___("
            + "      /*@synthetic*/this, event, "
            + "      ___./*@synthetic*/getId(IMPORTS___), @tail));"
            + "})",
            "tail", new Reference(SyntheticNodes.s(
                new Identifier(pos, handlerFnName))));
        eventAdapter.setFilePosition(pos);
        eventAdapter.getAttributes().set(HANDLER_NAME, handlerFnName);
        dynamicValue = eventAdapter;
        break;
      case STYLE:
        CssTree.DeclarationGroup decls = styleFromAttrib(attr);
        if (decls == null || decls.children().isEmpty()) {
          return noResult(attr);
        }

        // The validator will check that property values are well-formed,
        // marking those that aren't, and identifies all URLs.
        CssValidator v = new CssValidator(cssSchema, htmlSchema, mq)
            .withInvalidNodeMessageLevel(MessageLevel.WARNING);
        v.validateCss(AncestorChain.instance(decls));
        // The rewriter will remove any unsafe constructs.
        // and put URLs in the proper filename namespace
        new CssRewriter(meta.getUriPolicy(), cssSchema, mq)
            .withInvalidNodeMessageLevel(MessageLevel.WARNING)
            .rewrite(AncestorChain.instance(decls));
        new CssDynamicExpressionRewriter(meta).rewriteCss(decls);
        ArrayConstructor jsValue = CssDynamicExpressionRewriter.cssToJs(decls);

        if (jsValue.children().size() == 0) {
          // No declarations remain after sanitizing
          return noResult(attr);
        } else if (jsValue.children().size() == 1) {
          // Declarations have been reduced to a single, statically known
          // StringLiteral or dynamically computed Expression
          dynamicValue = jsValue.children().get(0);
        } else {
          throw new SomethingWidgyHappenedError(
              "Rewriter thinks STYLE attribute should contain plugin ID");
        }
        break;
      case URI:
        if (attributeContent.containsKey(attr.src)) {  // A javascript: URI
          Block b = this.jsFromAttrib(attr);
          if (b == null || b.children().isEmpty()) { return noResult(attr); }

          String handlerIndexName = meta.generateUniqueName("c");
          Identifier handlerIndex = SyntheticNodes.s(new Identifier(
              FilePosition.UNKNOWN, handlerIndexName));
          Statement handler = (Statement) QuasiBuilder.substV(
              ""
              + "var @handlerIndex = IMPORTS___.handlers___.push("
              + "    ___./*@synthetic*/markFuncFreeze("
              // There is no node or event object available to code in
              // javascript: URIs.
              + "        /*@synthetic*/function () { @body*; })) - 1;",
              "handlerIndex", handlerIndex,
              "body", new ParseTreeNodeContainer(b.children()));
          handlers.add(new EventHandler(attr.env, handler));
          handlerCache.put(value, handlerIndexName);

          Operation urlAdapter = (Operation) QuasiBuilder.substV(
              ""
              + "'javascript:' + /*@synthetic*/encodeURIComponent("
              + "   'try{void ___.plugin_dispatchToHandler___('"
              + "    + ___./*@synthetic*/getId(IMPORTS___)"
              + "    + ',' + @handlerIndex + ',[{}])}catch(_){}')",
              "handlerIndex", new Reference(handlerIndex));
          urlAdapter.setFilePosition(pos);
          urlAdapter.getAttributes().set(HANDLER_NAME, handlerIndexName);
          dynamicValue = urlAdapter;
        } else {
          URI uri;
          try {
            uri = new URI(UriUtil.normalizeUri(value));
          } catch (URISyntaxException ex) {
            mq.addMessage(
                IhtmlMessageType.MALFORMED_URI, pos,
                MessagePart.Factory.valueOf(value));
            return noResult(attr);
          }
          if (meta.getUriPolicy() != null) {
            ExternalReference ref = new ExternalReference(uri, pos);
            String rewrittenUri = UriPolicyNanny.apply(
                meta.getUriPolicy(),
                ref, attr.attrInfo.getUriEffect(),
                attr.attrInfo.getLoaderType(),
                Collections.singletonMap(
                    UriPolicyHintKey.XML_ATTR.key,
                    attr.attrInfo.getKey().toString()));
            if (rewrittenUri == null) {
              mq.addMessage(
                  PluginMessageType.DISALLOWED_URI, pos,
                  MessagePart.Factory.valueOf(uri.toString()));
              return noResult(attr);
            }
            dynamicValue = StringLiteral.valueOf(
                ref.getReferencePosition(), rewrittenUri);
          } else {
            dynamicValue = (Expression) QuasiBuilder.substV(
                ""
                + "IMPORTS___./*@synthetic*/rewriteUriInAttribute___("
                + "    @value, @tagName, @attribName)",
                "value", new StringLiteral(
                    pos, uri.toString()),
                "tagName", new StringLiteral(
                    pos, attr.src.getOwnerElement().getTagName()),
                "attribName", new StringLiteral(
                    pos, attr.src.getName()));
          }
        }
        break;
      case URI_FRAGMENT:
        if (value.length() < 2 || !value.startsWith("#")) {
          mq.addMessage(
              IhtmlMessageType.BAD_ATTRIB, pos,
              attr.attrInfo.getKey().el, attr.attrInfo.getKey(),
              MessagePart.Factory.valueOf(value));
          return noResult(attr);
        }
        String id = value.substring(1);
        if (!checkValidId(id, pos)) { return noResult(attr); }
        JsConcatenator out = new JsConcatenator();
        out.append(FilePosition.startOf(pos), "#");
        rewriteIdentifiers(pos, id, out);
        dynamicValue = out.toExpression(false);
        break;
      default:
        throw new SomethingWidgyHappenedError(attr.attrInfo.getType().name());
    }
    return new SanitizedAttr(true, dynamicValue);
  }

  Expression sanitizeFrameTargetValue(AttrValue attr) {
    // If the guest code supplied an attribute value for 'target', we get it
    // in 'attr.src'. Otherwise, TemplateCompiler gives us an 'attr.src' with
    // a value equal to the empty string, which Domado's rewriteTargetAttribute
    // interprets to mean that the guest code did not supply a value.
    FilePosition pos = attr.valuePos;
    boolean unspecified = null !=
        attr.src.getUserData(TemplateCompiler.ATTRIBUTE_VALUE_WAS_UNSPECIFIED);
    Expression value = unspecified
        ? new NullLiteral(pos)
        : new StringLiteral(pos, attr.src.getValue());
    return (Expression) QuasiBuilder.substV(""
        + "IMPORTS___./*@synthetic*/rewriteTargetAttribute___("
        + "    @value, @tagName, @attribName)",
        "value", value,
        "tagName", new StringLiteral(pos, attr.src.getOwnerElement().getTagName()),
        "attribName", new StringLiteral(pos, attr.attrInfo.getKey().localName));
  }

  private static final Pattern FORBIDDEN_ID = Pattern.compile("__\\s*$");

  private static final Pattern VALID_ID = Pattern.compile(
      "^[\\p{Alnum}_$\\-.:;=()\\[\\]]+$");

  /** True iff value is not a forbidden id */
  private boolean checkForbiddenId(String value, FilePosition pos) {
    if (!FORBIDDEN_ID.matcher(value).find()) { return true; }
    mq.addMessage(
        IhtmlMessageType.ILLEGAL_NAME, MessageLevel.WARNING, pos,
        MessagePart.Factory.valueOf(value));
    return false;
  }

  /** True iff value does not contain a forbidden id */
  private boolean checkForbiddenIdList(String value, FilePosition pos) {
    boolean ok = true;
    for (String ident : identifiers(value)) {
      ok &= checkForbiddenId(ident, pos);
    }
    return ok;
  }

  /** True if value is a valid id */
  private boolean checkValidId(String value, FilePosition pos) {
    if (!checkForbiddenId(value, pos)) { return false; }
    if ("".equals(value)) { return true; }
    if (VALID_ID.matcher(value).find()) { return true; }
    mq.addMessage(
        IhtmlMessageType.ILLEGAL_NAME, pos,
        MessagePart.Factory.valueOf(value));
    return false;
  }

  /** True iff value is a space-separated list of valid ids. */
  private boolean checkValidIdList(String value, FilePosition pos) {
    boolean ok = true;
    for (String ident : identifiers(value)) {
      ok &= checkValidId(ident, pos);
    }
    return ok;
  }

  /** "foo bar baz" -> "foo-suffix___ bar-suffix___ baz-suffix___". */
  private Expression rewriteIdentifiers(FilePosition pos, String names) {
    if ("".equals(names)) { return null; }
    JsConcatenator concat = new JsConcatenator();
    rewriteIdentifiers(pos, names, concat);
    Expression result = concat.toExpression(false);
    ((AbstractExpression) result).setFilePosition(pos);
    return result;
  }
  private void rewriteIdentifiers(
      FilePosition pos, String names, JsConcatenator concat) {
    Expression idClassExpr;
    String idClass = meta.getIdClass();
    if (idClass != null) {
      idClassExpr = StringLiteral.valueOf(FilePosition.UNKNOWN, idClass);
    } else {
      idClassExpr = (Expression) QuasiBuilder.substV(
          "IMPORTS___.getIdClass___()");
    }
    boolean first = true;
    for (String ident : identifiers(names)) {
      if ("".equals(ident)) { continue; }
      concat.append(pos, (first ? "" : " ") + ident + "-");
      concat.append(idClassExpr);
      first = false;
      pos = FilePosition.endOf(pos);
    }
  }

  /**
   * Convert "this" -> "thisNode___" in event handlers.  Event handlers are
   * run in a context where this points to the current node.
   * We need to emulate that but still allow the event handlers to be simple
   * functions, so we pass in the tamed node as the first parameter.
   *
   * The event handler goes from:<br>
   *   {@code if (this.type === 'text') alert(this.value); }
   * to a function like:<pre>
   *   function (thisNode___, event) {
   *     if (thisNode___.type === 'text') {
   *       alert(thisNode___.value);
   *     }
   *   }</pre>
   * <p>
   * And the resulting function is called via a handler attribute like
   * {@code onchange="___.plugin_dispatchEvent___(this, node, 1234, 'handlerName')"}
   */
  private static void rewriteEventHandlerReferences(Block block) {
    block.visitPreOrder(
        new ParseTreeNodeVisitor() {
          public boolean visit(ParseTreeNode node) {
            // Do not recurse into closures.
            if (node instanceof FunctionConstructor) { return false; }
            if (node instanceof Reference) {
              Reference r = (Reference) node;
              if (Keyword.THIS.toString().equals(r.getIdentifierName())) {
                Identifier oldRef = r.getIdentifier();
                Identifier thisNode = new Identifier(
                    oldRef.getFilePosition(), ReservedNames.THIS_NODE);
                r.replaceChild(SyntheticNodes.s(thisNode), oldRef);
              }
              return false;
            }
            return true;
          }
        });
  }

  static SanitizedAttr noResult(AttrValue a) {
    String safeValue = a.attrInfo.getSafeValue();
    String defaultValue = a.attrInfo.getDefaultValue();
    if (safeValue != null && defaultValue != null
        && !safeValue.equals(defaultValue)) {
      return new SanitizedAttr(
          true, StringLiteral.valueOf(a.valuePos, safeValue));
    }
    return new SanitizedAttr(false, null);
  }

  /**
   * Splits an attribute value specified as a space separated group of
   * identifiers.
   */
  private static Iterable<String> identifiers(String idents) {
    idents = idents.trim();
    return "".equals(idents)
        ? Collections.<String>emptyList()
        : Arrays.asList(idents.trim().split("\\s+"));
  }

  private Block jsFromAttrib(AttrValue v) {
    EmbeddedContent c = attributeContent.get(v.src);
    if (c == null) { return null; }
    try {
      ParseTreeNode n = c.parse(meta.getUriFetcher(), mq);
      if (n instanceof Block) { return (Block) n; }
    } catch (ParseException ex) {
      ex.toMessageQueue(mq);
    }
    return null;
  }

  private CssTree.DeclarationGroup styleFromAttrib(AttrValue v) {
    EmbeddedContent c = attributeContent.get(v.src);
    if (c == null) { return null; }
    try {
      ParseTreeNode n = c.parse(meta.getUriFetcher(), mq);
      if (n instanceof CssTree.DeclarationGroup) {
        return (CssTree.DeclarationGroup) n;
      }
    } catch (ParseException ex) {
      ex.toMessageQueue(mq);
    }
    return null;
  }
}
