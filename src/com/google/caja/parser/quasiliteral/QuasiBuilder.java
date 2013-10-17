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

package com.google.caja.parser.quasiliteral;

import com.google.caja.SomethingWidgyHappenedError;
import com.google.caja.lexer.CharProducer;
import com.google.caja.lexer.FilePosition;
import com.google.caja.lexer.InputSource;
import com.google.caja.lexer.JsLexer;
import com.google.caja.lexer.JsTokenQueue;
import com.google.caja.lexer.ParseException;
import com.google.caja.parser.ParseTreeNode;
import com.google.caja.parser.ParserBase;
import com.google.caja.parser.js.Block;
import com.google.caja.parser.js.DirectivePrologue;
import com.google.caja.parser.js.Expression;
import com.google.caja.parser.js.ExpressionStmt;
import com.google.caja.parser.js.FormalParam;
import com.google.caja.parser.js.FunctionConstructor;
import com.google.caja.parser.js.FunctionDeclaration;
import com.google.caja.parser.js.Identifier;
import com.google.caja.parser.js.LabeledStatement;
import com.google.caja.parser.js.LabeledStmtWrapper;
import com.google.caja.parser.js.ObjProperty;
import com.google.caja.parser.js.ObjectConstructor;
import com.google.caja.parser.js.Parser;
import com.google.caja.parser.js.Reference;
import com.google.caja.parser.js.Statement;
import com.google.caja.parser.js.StringLiteral;
import com.google.caja.parser.js.ValueProperty;
import com.google.caja.reporting.DevNullMessageQueue;
import com.google.common.collect.Lists;
import com.google.common.collect.Maps;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Creates a JavaScript {@link QuasiNode} tree given a JavaScript
 * {@link com.google.caja.parser.ParseTreeNode} tree.
 *
 * @author ihab.awad@gmail.com (Ihab Awad)
 */
public class QuasiBuilder {
  private static final Map<String, QuasiNode> patternCache
      = Collections.synchronizedMap(new LinkedHashMap<String, QuasiNode>() {
        private static final long serialVersionUID = 8370964871936109547L;

        @Override
        public boolean removeEldestEntry(Map.Entry<String, QuasiNode> e) {
          return this.size() > 256;
        }
      });

  /**
   * Match a quasiliteral pattern against a specimen.
   *
   * @param patternText a quasiliteral pattern.
   * @param specimen a specimen parse tree node.
   * @return whether the match succeeded.
   * @see QuasiNode#match(com.google.caja.parser.ParseTreeNode)
   */
  public static boolean match(String patternText, ParseTreeNode specimen) {
    return match(patternText, specimen, makeBindings());
  }

  /**
   * Match a quasiliteral pattern against a specimen, returning any
   * hole bindings found in a client supplied map.
   *
   * @param patternText a quasiliteral pattern.
   * @param specimen a specimen parse tree node.
   * @param bindings a map into which hole bindings resulting from the match
   *     will be placed.
   * @return whether the match succeeded.
   * @see QuasiNode#match(com.google.caja.parser.ParseTreeNode)
   */
  public static boolean match(
      String patternText,
      ParseTreeNode specimen,
      Map<String, ParseTreeNode> bindings) {
    Map<String, ParseTreeNode> tempBindings = getPatternNode(patternText)
        .match(specimen);

    if (tempBindings != null) {
      bindings.putAll(tempBindings);
      return true;
    }
    return false;
  }

  /**
   * Substitute variables into a quasiliteral pattern, returning a
   * concrete parse tree node.
   *
   * @param patternText a quasiliteral pattern.
   * @param bindings a set of bindings from names to parse tree nodes.
   * @return a new parse tree node resulting from the substitution.
   * @see QuasiNode#substitute(java.util.Map)
   */
  public static ParseTreeNode subst(
      String patternText, Map<String, ParseTreeNode> bindings) {
    return getPatternNode(patternText).substitute(bindings);
  }

  /**
   * Substitute variables into a quasiliteral pattern, returning a concrete
   * parse tree node, passing the bindings as a variable arguments list.
   *
   * @param patternText a quasiliteral pattern.
   * @param args an even number of values arranged in pairs of
   *     ({@code String}, {@code ParseTreeNode}) representing bindings to
   *     substitute into the pattern.
   * @return a new parse tree node resulting from the substitution.
   * @see #subst(String, java.util.Map)
   */
  public static ParseTreeNode substV(String patternText, Object... args) {
    if (args.length % 2 != 0) {
      throw new SomethingWidgyHappenedError("Wrong # of args for subst()");
    }
    Map<String, ParseTreeNode> bindings = makeBindings();
    for (int i = 0; i < args.length; i += 2) {
      ParseTreeNode value = (ParseTreeNode) args[i + 1];
      if (value != null) {
        // TODO(felix8a): can't do this because of ArrayIndexOptimization
        //value.makeImmutable();
      }
      bindings.put((String) args[i], value);
    }
    ParseTreeNode result = subst(patternText, bindings);
    if (result == null) {
      throw new NullPointerException(
          "'" + patternText + "' > " + bindings.keySet());
    }
    return result;
  }

  /**
   * Given a quasiliteral pattern expressed as text, return a {@code QuasiNode}
   * representing the pattern.
   *
   * @param inputSource description of input source of pattern text.
   * @param pattern a quasiliteral pattern.
   * @return the QuasiNode representation of the input.
   * @exception ParseException if there is a parsing problem.
   */
  public static QuasiNode parseQuasiNode(
      InputSource inputSource, String pattern)
      throws ParseException {
    // The top-level node returned from the parser is always a Block.
    Block topLevelBlock = (Block) parse(inputSource, pattern);
    ParseTreeNode topLevelNode = topLevelBlock;

    // If the top-level Block contains a single child, promote it to allow it to
    // match anywhere.
    if (topLevelNode.children().size() == 1) {
      topLevelNode = topLevelNode.children().get(0);
    }

    // If the top level is an ExpressionStmt, with one child, then promote its
    // single child to the top level to allow the contained expression to match
    // anywhere.
    if (topLevelNode instanceof ExpressionStmt) {
      topLevelNode = topLevelNode.children().get(0);
    }

    // If the top level is a FunctionDeclaration, promote its single child to
    // the top level to allow the contained FunctionConstructor to match in any
    // context.
    if (topLevelNode instanceof FunctionDeclaration) {
      topLevelNode = ((FunctionDeclaration) topLevelNode).getInitializer();
    }

    return build(topLevelNode);
  }

  /**
   * @see #parseQuasiNode(InputSource,String)
   * @see FilePosition#UNKNOWN
   */
  public static QuasiNode parseQuasiNode(String pattern) throws ParseException {
    return parseQuasiNode(FilePosition.UNKNOWN.source(), pattern);
  }

  /** This parallels the fuzzing done in
   * {@link QuasiBuilder#parseQuasiNode(InputSource, String)} */
  // TODO(felix8a): why is this comment a lie?
  public static Class<? extends ParseTreeNode> fuzzType(
      Class<? extends ParseTreeNode> nodeClass) {
    if (nodeClass == FunctionDeclaration.class) {
      return FunctionConstructor.class;
    }
    if (nodeClass == Expression.class) {
      return ExpressionStmt.class;
    }
    if (nodeClass == Reference.class) {
      return Identifier.class;
    }
    if (nodeClass == LabeledStmtWrapper.class) {
      return LabeledStatement.class;
    }
    return nodeClass;
  }

  private static QuasiNode getPatternNode(String patternText) {
    if (!patternCache.containsKey(patternText)) {
      try {
        patternCache.put(
            patternText,
            QuasiBuilder.parseQuasiNode(patternText));
      } catch (ParseException e) {
        throw new SomethingWidgyHappenedError("Pattern programming error", e);
      }
    }
    return patternCache.get(patternText);
  }

  private static QuasiNode build(ParseTreeNode n) {
    if (n instanceof ExpressionStmt &&
        ((ExpressionStmt) n).getExpression() instanceof Reference) {
      String name = ((Reference) n.children().get(0)).getIdentifierName();
      if (name.startsWith("@") && !name.endsWith("_")) {
        return buildMatchNode(Statement.class, name);
      }
    }

    if (n instanceof Reference) {
      String name = ((Reference) n).getIdentifierName();
      if (name.startsWith("@") && !name.endsWith("_")) {
        return buildMatchNode(Expression.class, name);
      }
    }

    if (n instanceof FormalParam) {
      String name = ((FormalParam) n).getIdentifierName();
      if (name.startsWith("@")) {
        return buildMatchNode(FormalParam.class, name);
      }
    }

    if (n instanceof Identifier) {
      String name = ((Identifier) n).getName();
      if (name != null && name.startsWith("@")) {
        boolean isOptional = name.endsWith("?");
        if (isOptional) { name = name.substring(0, name.length() - 1); }
        QuasiNode qn;
        if (name.endsWith("_")) {
          qn = buildTrailingUnderscoreMatchNode(name);
        } else {
          qn = buildMatchNode(Identifier.class, name);
        }
        if (isOptional) {
          qn = new SingleOptionalIdentifierQuasiNode(qn);
        }
        return qn;
      }
    }

    if (n instanceof ObjectConstructor) {
      return buildObjectConstructorNode((ObjectConstructor) n);
    }

    if (n instanceof DirectivePrologue) {
      return buildDirectivePrologueMatchNode(((DirectivePrologue) n).getDirectives());
    }

    if (n instanceof StringLiteral) {
      StringLiteral lit = (StringLiteral) n;
      String ident = quasiIdent(lit);
      if (ident != null
          // Make sure it doesn't end in * or ?.
          && Character.isJavaIdentifierPart(ident.charAt(ident.length() - 1))) {
        return new StringLiteralQuasiNode(ident.substring(1));
      }
    }

    return buildSimpleNode(n);
  }

  private static QuasiNode buildSimpleNode(ParseTreeNode n) {
    // StringLiteral values are the raw text, so compare by decoded value.
    QuasiNode.Equivalence cmp = (n instanceof StringLiteral)
        ? QuasiNode.EQUAL_UNESCAPED : QuasiNode.SAFE_EQUALS;

    return new SimpleQuasiNode(
        n.getClass(), n.getValue(), cmp, buildChildrenOf(n));
  }

  private static QuasiNode buildMatchNode(
      Class<? extends ParseTreeNode> matchedClass,
      String quasiString) {
    assert(quasiString.startsWith("@"));
    if (quasiString.endsWith("*")) {
      return new MultipleQuasiHole(
          matchedClass,
          quasiString.substring(1, quasiString.length() - 1));
    } else if (quasiString.endsWith("+")) {
      return new MultipleNonemptyQuasiHole(
          matchedClass,
          quasiString.substring(1, quasiString.length() - 1));
    } else if (quasiString.endsWith("?")) {
      return new SingleOptionalQuasiHole(
          matchedClass,
          quasiString.substring(1, quasiString.length() - 1));
    } else {
      return new SingleQuasiHole(
          matchedClass,
          quasiString.substring(1, quasiString.length()));
    }
  }

  private static QuasiNode buildTrailingUnderscoreMatchNode(String quasiString) {
    assert(quasiString.startsWith("@"));
    assert(quasiString.endsWith("_"));
    quasiString = quasiString.substring(1, quasiString.length());
    int numberOfUnderscores = 0;
    while (quasiString.endsWith("_")) {
      quasiString = quasiString.substring(0, quasiString.length() - 1);
      numberOfUnderscores++;
    }
    return new TrailingUnderscoresHole(quasiString, numberOfUnderscores);
  }

  /**
   * Extracts a quasi reference from a string literal.
   * <pre>
   * '"foo"'   => null,
   * '"@foo"'  => '@foo',
   * '"\@foo"' => null,  // Strings with escape sequences are treated literally.
   * '"@foo*"' => '@foo*'
   * </pre>
   */
  private static String quasiIdent(StringLiteral sl) {
    String raw = sl.getValue();
    int start = 0, end = raw.length();
    if (end - start >= 2 && raw.charAt(end - 1) == raw.charAt(start)) {
      switch (raw.charAt(start)) {
        case '\'': case '"': start = 1; --end; break;
      }
    }
    if (start >= end || raw.charAt(start) != '@') { return null; }
    int identStart = start + 1;
    int identEnd = end;
    if (identEnd > identStart) {
      switch (raw.charAt(identEnd - 1)) {
        case '?': case '*': case '+': --identEnd; break;
      }
    }
    if (ParserBase.isJavascriptIdentifier(StringLiteral.unescapeJsString(
            raw.substring(identStart, identEnd)))) {
      return StringLiteral.unescapeJsString(raw.substring(start, end));
    }
    return null;
  }

  private static QuasiNode buildObjectConstructorNode(ObjectConstructor obj) {
    List<QuasiNode> propQuasis = Lists.newArrayList();
    for (ObjProperty prop : obj.children()) {
      StringLiteral key = prop.getPropertyNameNode();
      if (prop instanceof ValueProperty) {
        Expression value = ((ValueProperty) prop).getValueExpr();
        String keyIdent = quasiIdent(key);
        if (value instanceof Reference) {
          String valueStr = ((Reference) value).getIdentifierName();
          if (keyIdent != null && keyIdent.endsWith("*")
              && valueStr.startsWith("@") && valueStr.endsWith("*")) {
            propQuasis.add(new MultiPropertyQuasi(
                keyIdent.substring(1, keyIdent.length() - 1),
                valueStr.substring(1, valueStr.length() - 1)));
            continue;
          }
        }
        QuasiNode keyQuasi = build(
            keyIdent != null
            ? new Reference(new Identifier(FilePosition.UNKNOWN, keyIdent))
            : key);
        propQuasis.add(new SinglePropertyQuasi(keyQuasi, build(value)));
      } else {
        // TODO: support getters and setters in object quasis
        throw new UnsupportedOperationException(prop.getClass().getName());
      }
    }
    return new ObjectCtorQuasiNode(propQuasis.toArray(new QuasiNode[0]));
  }

  private static QuasiNode buildDirectivePrologueMatchNode(
      Set<String> subsetNames) {
    return new DirectivePrologueQuasiNode(subsetNames);
  }

  private static QuasiNode[] buildChildrenOf(ParseTreeNode n) {
    List<QuasiNode> children = Lists.newArrayList();
    for (ParseTreeNode child : n.children()) children.add(build(child));
    return children.toArray(new QuasiNode[children.size()]);
  }

  private static ParseTreeNode parse(
      InputSource inputSource,
      String sourceText) throws ParseException {
    Parser parser = new Parser(
        new JsTokenQueue(
            new JsLexer(
                CharProducer.Factory.fromString(sourceText, inputSource),
                true),
            inputSource),
        DevNullMessageQueue.singleton(),
        true);

    Statement topLevelStatement = parser.parse();
    parser.getTokenQueue().expectEmpty();
    return topLevelStatement;
  }

  private static Map<String, ParseTreeNode> makeBindings() {
     return Maps.newLinkedHashMap();
  }
}
