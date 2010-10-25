// Copyright (C) 2007 Google Inc.
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

package com.google.caja.parser.html;

import com.google.caja.SomethingWidgyHappenedError;
import com.google.caja.lexer.FilePosition;
import com.google.caja.lexer.HtmlEntities;
import com.google.caja.lexer.HtmlTokenType;
import com.google.caja.lexer.Token;
import com.google.caja.reporting.Message;
import com.google.caja.reporting.MessageLevel;
import com.google.caja.reporting.MessagePart;
import com.google.caja.reporting.MessageQueue;
import com.google.caja.reporting.MessageType;
import com.google.caja.util.Lists;
import com.google.caja.util.Maps;
import com.google.caja.util.Strings;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.WeakHashMap;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.w3c.dom.Attr;
import org.w3c.dom.DOMException;
import org.w3c.dom.Document;
import org.w3c.dom.DocumentFragment;
import org.w3c.dom.Element;
import org.w3c.dom.NamedNodeMap;
import org.w3c.dom.Node;
import org.w3c.dom.Text;
import org.xml.sax.ErrorHandler;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;

import nu.validator.htmlparser.common.DoctypeExpectation;
import nu.validator.htmlparser.common.XmlViolationPolicy;
import nu.validator.htmlparser.impl.AttributeName;
import nu.validator.htmlparser.impl.ElementName;
import nu.validator.htmlparser.impl.HtmlAttributes;
import nu.validator.htmlparser.impl.Tokenizer;

/**
 * A bridge between DomParser and html5lib which translates
 * {@code Token<HtmlTokenType>}s into SAX style events which are fed to the
 * TreeBuilder.  The TreeBuilder responds by issuing {@code createElementNS}
 * commands which are used to build a {@link DocumentFragment}.
 *
 * @author mikesamuel@gmail.com
 */
public class Html5ElementStack implements OpenElementStack {
  public static final Logger logger = Logger.getLogger(
      Html5ElementStack.class.getName());
  private final CajaTreeBuilder builder;
  private final char[] charBuf = new char[1024];
  private final MessageQueue mq;
  private final Document doc;
  private final boolean needsDebugData;
  private final Map<String, ElementName> elNames = Maps.newHashMap();
  private boolean isFragment;
  private boolean needsNamespaceFixup;
  private boolean topLevelHtmlFromInput = false;
  private boolean processingFirstTag = true;

  /**
   * @param doc The document being processed.
   * @param needsDebugData see {@link DomParser#setNeedsDebugData(boolean)}
   * @param queue will receive error messages from html5lib.
   */
  Html5ElementStack(Document doc, boolean needsDebugData, MessageQueue queue) {
    this.doc = doc;
    this.needsDebugData = needsDebugData;
    this.mq = queue;
    builder = new CajaTreeBuilder(doc, needsDebugData, mq);
  }

  public final Document getDocument() { return doc; }

  public boolean needsNamespaceFixup() { return needsNamespaceFixup; }

  /** {@inheritDoc} */
  public void open(boolean isFragment) {
    this.isFragment = isFragment;
    if (isFragment) {
      builder.setFragmentContext(null);
    }
    builder.setDoctypeExpectation(DoctypeExpectation.NO_DOCTYPE_ERRORS);
    try {
      builder.startTokenization(new Tokenizer(builder));
    } catch (SAXException ex) {
      throw new SomethingWidgyHappenedError(ex);
    }
    builder.setErrorHandler(
        new ErrorHandler() {
          private FilePosition lastPos;
          private String lastMessage;

          public void error(SAXParseException ex) {
            // htmlparser is a bit strident, so we lower it's warnings to
            // MessageLevel.LINT.
            report(MessageLevel.LINT, ex);
          }
          public void fatalError(SAXParseException ex) {
            report(MessageLevel.FATAL_ERROR, ex);
          }
          public void warning(SAXParseException ex) {
            report(MessageLevel.LINT, ex);
          }

          private void report(MessageLevel level, SAXParseException ex) {
            String message = errorMessage(ex);
            FilePosition pos = builder.getErrorLocation();
            if (message.equals(lastMessage) && pos.equals(lastPos)) { return; }
            lastMessage = message;
            lastPos = pos;
            mq.getMessages().add(new Message(
                DomParserMessageType.GENERIC_SAX_ERROR, level, pos,
                MessagePart.Factory.valueOf(message)));
          }

          private String errorMessage(SAXParseException ex) {
            // Don't ask.
            return ex.getMessage()
                .replace('\u201c', '\'').replace('\u201d', '\'');
          }
        });
  }

  /** {@inheritDoc} */
  public void finish(FilePosition endOfFile) {
    if (CajaTreeBuilder.DEBUG) {
      System.err.println("finish(" + endOfFile + ")");
    }
    builder.finish(endOfFile);
    if (CajaTreeBuilder.DEBUG) {
      System.err.println("closeUnclosedNodes");
    }
    builder.closeUnclosedNodes();
  }

  public static String canonicalizeName(String name) {
    if (name.indexOf(':') >= 0) {  // Do not case-normalize embedded XML.
      return name;
    } else {
      // Forces LANG=C like behavior.
      return Strings.toLowerCase(name);
    }
  }

  static String canonicalElementName(String elementName) {
    return canonicalizeName(elementName);
  }

  static String canonicalAttributeName(String attributeName) {
    return canonicalizeName(attributeName);
  }

  /** {@inheritDoc} */
  public DocumentFragment getRootElement() {
    // libHtmlParser always produces a document with html, head, and body tags
    // which we usually don't want, so unroll it.

    // If we can't throw away the head element, and the body header, then we
    // return the entire document.  Otherwise, we return a document fragment
    // consisting of the contents of the body.

    Element root = builder.getRootElement();
    DocumentFragment result = doc.createDocumentFragment();
    if (needsDebugData) {
      Nodes.setFilePositionFor(result, builder.getFragmentBounds());
    }

    final Node first = root.getFirstChild();

    if (!isFragment || topLevelHtmlFromInput) {
      result.appendChild(root);
      return result;
    }

    // If disposing of the html, body, or head elements would lose info don't
    // do it, so look for attributes.
    boolean tagsBesidesHeadBodyFrameset = false;
    boolean topLevelTagsWithAttributes = hasSpecifiedAttributes(root);

    for (Node child = first; child != null; child = child.getNextSibling()) {
      if (child instanceof Element) {
        Element el = (Element) child;
        String tagName = el.getTagName();
        if (!("head".equals(tagName) || "body".equals(tagName)
              || "frameset".equals(tagName))) {
          tagsBesidesHeadBodyFrameset = true;
          break;
        }
        if (!topLevelTagsWithAttributes
            && hasSpecifiedAttributes(el)
            // framesets, unlike body elements, are never created out of whole
            // cloth, so we do not behave differently when there is a frameset
            // with attributes.
            && !"frameset".equals(tagName)) {
          topLevelTagsWithAttributes = true;
        }
      }
    }

    // topLevelTagsWithAttributes is true in the following cases
    //   <html xml:lang="en">...</html>
    //   <html><body bgcolor=white>...</body></html>
    // tagsBesidesHeadAndBody is true for
    //   <html><frameset>...</frameset></html>
    if (tagsBesidesHeadBodyFrameset || topLevelTagsWithAttributes) {
      // Merging the body and head would lose info.
      result.appendChild(root);
      return result;
    }

    // Merge the body and head into a fragment.
    // Convert
    // <html>
    //   <head>
    //     <link rel=stylesheet ...>
    //   </head>
    //   <body>
    //     <p>Hello World</p.
    //   </body>
    // </html>
    // to
    // #fragment
    //   <link rel=stylesheet ...>
    //   <p>Hello World</p.

    Node pending = null;
    for (Node child = first; child != null; child = child.getNextSibling()) {
      if (child instanceof Element) {
        String tagName = ((Element) child).getTagName();
        if ("head".equals(tagName) || "body".equals(tagName)) {
          // Shallow descent
          for (Node grandchild = child.getFirstChild(); grandchild != null;
               grandchild = grandchild.getNextSibling()) {
            pending = appendNormalized(pending, grandchild, result);
          }
        } else {  // reached for framesets
          pending = child;
        }
      } else {
        pending = appendNormalized(pending, child, result);
      }
    }
    if (pending != null) { result.appendChild(pending); }

    return result;
  }

  private static boolean hasSpecifiedAttributes(Element el) {
    NamedNodeMap attrs = el.getAttributes();
    for (int i = 0, n = attrs.getLength(); i < n; ++i) {
      Attr a = (Attr) attrs.item(i);
      if (el.hasAttributeNS(a.getNamespaceURI(), a.getLocalName())) {
        return true;
      }
    }
    return false;
  }

  /**
   * Given one or two nodes, see if the two can be combined.
   * If two are passed in, they might be combined into one and returned, or
   * the first will be appended to parent, and the other returned.
   */
  private Node appendNormalized(
      Node pending, Node current, DocumentFragment parent) {
    if (pending == null) { return current; }
    if (pending.getNodeType() != Node.TEXT_NODE
        || current.getNodeType() != Node.TEXT_NODE) {
      parent.appendChild(pending);
      return current;
    }
    Text a = (Text) pending, b = (Text) current;
    Text combined = doc.createTextNode(a.getTextContent() + b.getTextContent());
    if (needsDebugData) {
      Nodes.setFilePositionFor(
          combined,
          FilePosition.span(
              Nodes.getFilePositionFor(a),
              Nodes.getFilePositionFor(b)));
      Nodes.setRawText(combined, Nodes.getRawText(a) + Nodes.getRawText(b));
    }
    return combined;
  }

  /**
   * Records the fact that a tag has been seen, updating internal state
   *
   * @param start the token of the beginning of the tag, so {@code "<p"} for a
   *   paragraph start, {@code "</p"} for an end tag.
   * @param end the token of the beginning of the tag, so {@code ">"} for a
   *   paragraph start, {@code "/>"} for an unary break tag.
   * @param attrStubs the attributes for the element.
   */
  public void processTag(Token<HtmlTokenType> start, Token<HtmlTokenType> end,
                         List<AttrStub> attrStubs) {
    if (CajaTreeBuilder.DEBUG) {
      System.err.println("processTag(" + start + ", " + end + ")");
    }
    boolean isEndTag = CajaTreeBuilder.isEndTag(start.text);
    String tagName = start.text.substring(isEndTag ? 2 : 1);
    boolean isHtml = checkName(tagName);
    if (isHtml) { tagName = Strings.toLowerCase(tagName); }

    HtmlAttributes htmlAttrs = new HtmlAttributes(AttributeName.HTML);
    List<Attr> attrs = Lists.newArrayList();
    if (!attrStubs.isEmpty()) {
      for (AttrStub as : attrStubs) {
        String qname = as.nameTok.text;
        Attr attrNode;
        boolean isAttrHtml;
        try {
          String name;
          if ("xmlns".equals(qname)) {
            if (!Namespaces.HTML_NAMESPACE_URI.equals(as.value)) {
              // We do not allow overriding of the default namespace when
              // parsing HTML.
              mq.addMessage(
                  MessageType.CANNOT_OVERRIDE_DEFAULT_NAMESPACE_IN_HTML,
                  as.nameTok.pos);
            }
            continue;
          } else {
            isAttrHtml = isHtml && checkName(qname);
            if (isAttrHtml) {
              name = Strings.toLowerCase(qname);
              attrNode = maybeCreateAttributeNs(Namespaces.HTML_NAMESPACE_URI,
                                                name, as);
              if (attrNode == null) {
                // Ignore this attribute.
                continue;
              }
            } else {
              name = AttributeNameFixup.fixupNameFromQname(qname);
              attrNode = maybeCreateAttribute(name, as);
              if (attrNode == null) {
                // Ignore this attribute.
                continue;
              }
            }
          }
          attrNode.setValue(as.value);
          if (needsDebugData) {
            Nodes.setFilePositionFor(attrNode, as.nameTok.pos);
            Nodes.setFilePositionForValue(attrNode, as.valueTok.pos);
            Nodes.setRawValue(attrNode, as.valueTok.text);
          }
          attrs.add(attrNode);
          try {
            htmlAttrs.addAttribute(
                AttributeName.nameByString(name),
                as.value, XmlViolationPolicy.ALLOW);
          } catch (SAXException ex) {
            if (CajaTreeBuilder.DEBUG) { ex.printStackTrace(); }
          }
        } catch (DOMException ex) {
          ex.printStackTrace();
          mq.addMessage(
              MessageType.INVALID_IDENTIFIER, MessageLevel.WARNING,
              as.nameTok.pos,
              MessagePart.Factory.valueOf(as.nameTok.text));
        }
      }
    }
    ElementName elName = elNames.get(tagName);
    if (elName == null) {
      elName = ElementName.elementNameByString(tagName);
      // Store element names because the underlying tree builder compares them
      // using ==.
      elNames.put(tagName, elName);
    }
    if (processingFirstTag && elName == ElementName.HTML && !isEndTag) {
      // Indicate to fragment-retrieval code that the top-level
      // <html> element came from the input, and wasn't synthesized
      // by the underlying parser implementation.
      topLevelHtmlFromInput = true;
    }
    processingFirstTag = false;
    try {
      if (builder.needsDebugData) {
        if (isEndTag) {
          // Version 1.2.1 of the TreeBuilder has a bug where it does not
          // generate element popped events for body and head elements.
          if (elName == ElementName.HTML) {
            Token<HtmlTokenType> tok= Token.instance(
                "", HtmlTokenType.TAGEND, FilePosition.startOf(start.pos));
            if (!builder.wasOpened("frameset")) {
              builder.setTokenContext(tok, tok);
              if (!builder.wasOpened("body")) {
                if (!builder.wasOpened("head")) {
                  builder.startTag(
                      ElementName.HEAD, HtmlAttributes.EMPTY_ATTRIBUTES, false);
                  builder.endTag(ElementName.HEAD);
                }
                builder.headClosed();
                builder.startTag(
                    ElementName.BODY, HtmlAttributes.EMPTY_ATTRIBUTES, false);
                builder.endTag(ElementName.BODY);
              }
              builder.bodyClosed();
            }
          }
        }
        builder.setTokenContext(start, end);
      }
      if (isEndTag) {
        builder.endTag(elName);
        if (builder.needsDebugData) {
          // Make sure that implicit body and head tag are marked as ending
          // before the </html> tag.
          if (elName == ElementName.BODY) {
            builder.bodyClosed();
          } else if (elName == ElementName.HEAD) {
            builder.headClosed();
          }
        }
      } else {
        builder.startTag(elName, toHtmlAttributes(attrs, htmlAttrs),
                         end.text.equals("/>"));
      }
    } catch (SAXException ex) {
      throw new SomethingWidgyHappenedError(ex);
    }
  }

  /**
   * Adds the given comment node to the DOM.
   */
  public void processComment(Token<HtmlTokenType> commentToken) {
    String text = commentToken.text.substring(
        "<!--".length(), commentToken.text.lastIndexOf("--"));
    commentToken = Token.instance(text, commentToken.type, commentToken.pos);
    char[] chars;
    int n = text.length();
    if (n <= charBuf.length) {
      chars = charBuf;
      text.getChars(0, n, chars, 0);
    } else {
      chars = text.toCharArray();
    }
    builder.setTokenContext(commentToken, commentToken);
    try {
      builder.comment(chars, 0, n);
    } catch (SAXException ex) {
      throw new RuntimeException(ex);
    }
  }

  private boolean checkName(String qname) {
    if (qname.indexOf(':', 1) < 0) {
      return true;
    } else {
      needsNamespaceFixup = true;
      return false;
    }
  }

  private static final Map<HtmlAttributes, List<Attr>> HTML_ASSOCIATED_ATTRS
      = new WeakHashMap<HtmlAttributes, List<Attr>>();
  private static HtmlAttributes toHtmlAttributes(
      List<Attr> attrs, HtmlAttributes blank) {
    HTML_ASSOCIATED_ATTRS.put(blank, attrs);
    return blank;
  }

  static List<Attr> getAssociatedAttrs(HtmlAttributes attrs) {
    List<Attr> attrList = HTML_ASSOCIATED_ATTRS.get(attrs);
    if (attrList == null) { attrList = Collections.emptyList(); }
    return attrList;
  }

  /**
   * Adds the given text node to the DOM.
   */
  public void processText(Token<HtmlTokenType> textToken) {
    if (CajaTreeBuilder.DEBUG) {
      System.err.println(
          "processText(\""
          + textToken.text.replaceAll("\r\n?|\n", "\\n") + "\")");
    }
    // htmlparser doesn't recognize \r as whitespace.
    String text = textToken.text.replaceAll("\r\n?", "\n");
    if (textToken.type == HtmlTokenType.TEXT) {
      text = fixBrokenEntities(text, textToken.pos);
    }
    if (text.equals(textToken.text)) {
      textToken = Token.instance(text, textToken.type, textToken.pos);
    }
    char[] chars;
    int n = text.length();
    if (n <= charBuf.length) {
      chars = charBuf;
      text.getChars(0, n, chars, 0);
    } else {
      chars = text.toCharArray();
    }
    builder.setTokenContext(textToken, textToken);
    try {
      builder.characters(chars, 0, n);
    } catch (SAXException ex) {
      throw new SomethingWidgyHappenedError(ex);
    }
  }

  /**
   * Matches possible HTML entities that lack a closing semicolon.
   */
  private static final Pattern BROKEN_ENTITY = Pattern.compile(
      ""
      + "&(?:"
        // A named entity.
        + "[A-Za-z][0-9A-Za-z]{1,11}(?![;0-9A-Za-z])"
        // A numeric entity.
        + "|#(?:"
          // A decimal entity
          + "[0-9]{1,7}(?![;0-9])"
          // A hexadecimal entity.
          + "|[Xx][0-9A-Fa-f]{1,6}(?![;0-9A-Fa-f])"
        + ")"
      + ")"
      );
  public String fixBrokenEntities(String rawText, FilePosition fp) {
    int amp = rawText.indexOf('&');
    if (amp >= 0) {
      Matcher m = BROKEN_ENTITY.matcher(rawText);
      if (m.find(amp)) {
        StringBuilder sb = new StringBuilder(rawText.length() + 16);
        int pos = 0;
        do {
          String entity = m.group();
          if (entity.charAt(1) == '#'
              || HtmlEntities.isEntityName(entity.substring(1))) {
            sb.append(rawText, pos, m.end()).append(';');
            pos = m.end();
            if (needsDebugData) {
              mq.addMessage(
                  MessageType.MALFORMED_HTML_ENTITY, fp,
                  MessagePart.Factory.valueOf(entity));
            }
          }
        } while (m.find());
        if (pos != 0) {
          sb.append(rawText, pos, rawText.length());
          return sb.toString();
        }
      }
    }
    return rawText;
  }

  /**
   * Creates a w3c dom attribute.
   *
   * @param attrName Attribute name.
   * @param as The attribute stub.
   * @return A w3c attribute if the attribute name is valid, null otherwise.
   */
  public Attr maybeCreateAttribute(String attrName, AttrStub as) {
    try {
      return doc.createAttribute(attrName);
    } catch (DOMException e) {
      // Ignore DOMException's like INVALID_CHARACTER_ERR since its an html
      // document.
      mq.addMessage(DomParserMessageType.IGNORING_TOKEN, as.nameTok.pos,
                    MessagePart.Factory.valueOf("'" + as.nameTok.text + "'"));
      logger.log(Level.FINE, "Ignoring DOMException in maybeCreateAttribute",
                 e);
      return null;
    }
  }

  /**
   * Creates a w3c dom attribute in the given namespace.
   *
   * @param nsUri The namespace uri to use.
   * @param attrName Attribute name.
   * @param as The attribute stub.
   * @return A w3c attribute if the attribute name is valid, null otherwise.
   */
  public Attr maybeCreateAttributeNs(String nsUri, String attrName,
                                     AttrStub as) {
    try {
      return doc.createAttributeNS(nsUri, attrName);
    } catch (DOMException e) {
      // Ignore DOMException's like INVALID_CHARACTER_ERR since its an html
      // document.
      mq.addMessage(DomParserMessageType.IGNORING_TOKEN, as.nameTok.pos,
                    MessagePart.Factory.valueOf("'" + as.nameTok.text + "'"));
      logger.log(Level.FINE, "Ignoring DOMException in maybeCreateAttributeNs",
                 e);
      return null;
    }
  }

  // For testing.
  Element builderRootElement() {
    return builder.getRootElement();
  }
}
