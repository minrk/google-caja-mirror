// Copyright (C) 2008 Google Inc.
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

package com.google.caja.ancillary.linter;

import com.google.caja.lexer.CharProducer;
import com.google.caja.lexer.InputSource;
import com.google.caja.lexer.JsLexer;
import com.google.caja.lexer.JsTokenQueue;
import com.google.caja.lexer.JsTokenType;
import com.google.caja.lexer.ParseException;
import com.google.caja.lexer.Token;
import com.google.caja.lexer.TokenConsumer;
import com.google.caja.parser.AncestorChain;
import com.google.caja.parser.ParseTreeNode;
import com.google.caja.parser.ParserBase;
import com.google.caja.parser.js.Block;
import com.google.caja.parser.js.BreakStmt;
import com.google.caja.parser.js.ContinueStmt;
import com.google.caja.parser.js.Expression;
import com.google.caja.parser.js.ExpressionStmt;
import com.google.caja.parser.js.ForEachLoop;
import com.google.caja.parser.js.ForLoop;
import com.google.caja.parser.js.FunctionConstructor;
import com.google.caja.parser.js.FunctionDeclaration;
import com.google.caja.parser.js.LabeledStatement;
import com.google.caja.parser.js.Literal;
import com.google.caja.parser.js.Loop;
import com.google.caja.parser.js.Operation;
import com.google.caja.parser.js.Operator;
import com.google.caja.parser.js.Parser;
import com.google.caja.parser.js.Reference;
import com.google.caja.parser.js.ReturnStmt;
import com.google.caja.parser.js.Statement;
import com.google.caja.parser.js.ThrowStmt;
import com.google.caja.parser.js.WithStmt;
import com.google.caja.reporting.MessageContext;
import com.google.caja.reporting.MessageLevel;
import com.google.caja.reporting.MessagePart;
import com.google.caja.reporting.MessageQueue;
import com.google.caja.reporting.MessageType;
import com.google.caja.reporting.RenderContext;
import com.google.caja.reporting.SimpleMessageQueue;
import com.google.caja.tools.BuildCommand;
import com.google.caja.util.Lists;
import com.google.caja.util.Maps;
import com.google.caja.util.Pair;
import com.google.caja.util.Sets;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.Collection;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * A build task that performs sanity checks on JavaScript inputs, and if there
 * are no warnings or errors, outputs a time-stamp file to record the time at
 * which the linter passed.
 *
 * @author mikesamuel@gmail.com
 */
public class Linter implements BuildCommand {

  public boolean build(List<File> inputs, List<File> dependencies, File output)
      throws IOException {
    MessageContext mc = new MessageContext();
    Map<InputSource, CharSequence> contentMap = Maps.newLinkedHashMap();
    MessageQueue mq = new SimpleMessageQueue();
    List<LintJob> lintJobs = parseInputs(inputs, contentMap, mc, mq);
    lint(lintJobs, mq);
    if (ErrorReporter.reportErrors(contentMap, mc, mq, System.out)
        .compareTo(MessageLevel.WARNING) < 0) {
      // Touch the time-stamp file to make it clear that the inputs were
      // successfully linted.
      (new FileOutputStream(output)).close();
      return true;
    } else {
      return false;
    }
  }

  private static List<LintJob> parseInputs(
      List<File> inputs, Map<InputSource, CharSequence> contents,
      MessageContext mc, MessageQueue mq)
      throws IOException {
    List<LintJob> compUnits = Lists.newArrayList();
    // Parse each input, and find annotations.
    for (File inp : inputs) {
      InputSource src = new InputSource(inp.toURI());
      mc.addInputSource(src);

      CharProducer cp = CharProducer.Factory.create(
          new InputStreamReader(new FileInputStream(inp), "UTF-8"), src);
      contents.put(src, new FileContent(cp));

      JsTokenQueue tq = new JsTokenQueue(new JsLexer(cp), src);
      try {
        if (tq.isEmpty()) { continue; }
        List<Token<JsTokenType>> tokens = tq.filteredTokens();
        Parser p = new Parser(tq, mq);
        compUnits.add(
            new LintJob(
                src,
                parseIdentifierListFromComment("requires", tokens, mq),
                parseIdentifierListFromComment("provides", tokens, mq),
                parseIdentifierListFromComment("overrides", tokens, mq),
                p.parse()));
      } catch (ParseException ex) {
        ex.toMessageQueue(mq);
      }
    }
    return compUnits;
  }

  // Visible for testing
  static void lint(List<LintJob> jobs, MessageQueue mq) {
    for (LintJob job : jobs) {
      lint(AncestorChain.instance(job.program),
           // Anything defined by this file can be read by this file.
           job.provides, job.requires, job.overrides, mq);
    }
    // Check that two files do not provide the same thing.
    Map<String, InputSource> providedBy = Maps.newHashMap();
    for (LintJob job : jobs) {
      for (String symbolName : job.provides) {
        InputSource originallyDefinedIn = providedBy.put(symbolName, job.src);
        if (originallyDefinedIn != null) {
          mq.addMessage(
              LinterMessageType.MULTIPLY_PROVIDED_SYMBOL,
              job.src, originallyDefinedIn,
              MessagePart.Factory.valueOf(symbolName));
        }
      }
    }
  }

  /**
   * @param ac the node to check.
   * @param mq receives messages about violations of canRead and canSet.
   */
  private static void lint(
      AncestorChain<?> ac,
      Set<String> provides, final Set<String> requires,
      final Set<String> overrides,
      MessageQueue mq) {
    ScopeAnalyzer sa = new ScopeAnalyzer() {
      @Override
      protected boolean introducesScope(AncestorChain<?> ac) {
        if (super.introducesScope(ac)) { return true; }
        return isLoopy(ac);
      }
      @Override
      protected void initScope(LexicalScope scope) {
        super.initScope(scope);
        if (scope.isFunctionScope()) {
          FunctionConstructor fc = scope.root.cast(FunctionConstructor.class)
              .node;
          // Simulate JScript quirks around named functions
          if (fc.getIdentifierName() != null
              && scope.root.parent != null
              && !(scope.root.parent.node instanceof FunctionDeclaration)) {
            LexicalScope containing = scope.parent;
            while (containing.parent != null
                   && (hoist(scope.root, containing)
                       || isLoopy(containing.root))) {
              containing = containing.parent;
            }
            containing.symbols.declare(fc.getIdentifierName(), scope.root);
          }
        } else if (scope.isGlobal()) {
          for (String symbolName : Sets.union(requires, overrides)) {
            if (scope.symbols.getSymbol(symbolName) == null) {
              scope.symbols.declare(symbolName, scope.root);
            }
          }
        }
      }
      boolean isLoopy(AncestorChain<?> ac) {
        ParseTreeNode node = ac.node;
        return node instanceof ForEachLoop || node instanceof Loop;
      }
    };
    List<LexicalScope> scopes = sa.computeLexicalScopes(ac);
    LexicalScope globalScope = scopes.get(0);
    VariableLiveness.LiveCalc lc = VariableLiveness.calculateLiveness(ac.node);
    NodeBuckets buckets = NodeBuckets.maker()
        .with(ExpressionStmt.class)
        .with(LabeledStatement.class)
        .under(globalScope.root);

    checkDeclarations(scopes, overrides, mq);
    checkLabels(lc, buckets, mq);
    checkUses(scopes, lc.vars, sa, provides, requires, overrides, mq);
    checkSideEffects(buckets, mq);
    checkDeadCode(buckets, mq);
  }

  private static void checkDeclarations(
      List<LexicalScope> scopes, Set<String> overrides, MessageQueue mq) {
    // Check that declarations don't conflict
    for (LexicalScope scope : scopes) {
      for (String symbolName : scope.symbols.symbolNames()) {
        Collection<AncestorChain<?>> declarations
            = scope.symbols.getSymbol(symbolName).getDeclarations();
        if (declarations.size() != 1) {
          Iterator<AncestorChain<?>> it = declarations.iterator();
          AncestorChain<?> original = it.next();
          // Overrides are weird.  They may already exist, but it's often best
          // to define them.  But there's no reason to redefine built-ins.
          if (!(scope.isGlobal() && overrides.contains(symbolName))) {
            while (it.hasNext()) {
              AncestorChain<?> redefinition = it.next();
              mq.addMessage(
                  MessageType.SYMBOL_REDEFINED,
                  redefinition.node.getFilePosition(),
                  MessagePart.Factory.valueOf(symbolName),
                  original.node.getFilePosition());
            }
          }
        }
        // Check that this symbol does not mask one in the same function scope.
        if (!scope.isFunctionScope()) {
          for (LexicalScope p = scope; (p = p.parent) != null;) {
            SymbolTable.Symbol masked = p.symbols.getSymbol(symbolName);
            if (masked != null) {
              mq.addMessage(
                  MessageType.MASKING_SYMBOL,
                  (scope.isCatchScope()
                   ? MessageLevel.WARNING
                   : MessageLevel.ERROR),
                  declarations.iterator().next().node.getFilePosition(),
                  MessagePart.Factory.valueOf(symbolName),
                  masked.getDeclarations().iterator()
                      .next().node.getFilePosition());
            }
            if (p.isFunctionScope()) { break; }
          }
        }
      }
    }
  }

  private static void checkLabels(
      VariableLiveness.LiveCalc lc, NodeBuckets buckets, MessageQueue mq) {
    // Complain about break/continues to non-existent labels.
    for (Statement exit : lc.exits.liveExits()) {
      if (exit instanceof BreakStmt || exit instanceof ContinueStmt) {
        String label = (String) exit.getValue();
        if ("".equals(label)) { label = "<default>"; }
        mq.addMessage(
            LinterMessageType.LABEL_DOES_NOT_MATCH_LOOP, exit.getFilePosition(),
            MessagePart.Factory.valueOf(label));
      } else if (exit instanceof ReturnStmt) {
        mq.addMessage(
            LinterMessageType.RETURN_OUTSIDE_FUNCTION, exit.getFilePosition());
      } else if (exit instanceof ThrowStmt) {
        mq.addMessage(
            LinterMessageType.UNCAUGHT_THROW_DURING_INIT,
            exit.getFilePosition());
      }
    }

    // Complain about masking labels
    for (AncestorChain<LabeledStatement> ls
         : buckets.get(LabeledStatement.class)) {
      String label = ls.node.getLabel();
      if ("".equals(label)) { continue; }  // allowed to nest
      for (AncestorChain<?> p = ls; (p = p.parent) != null;) {
        if (p.node instanceof LabeledStatement
            && label.equals(p.cast(LabeledStatement.class).node.getLabel())) {
          mq.addMessage(
              LinterMessageType.DUPLICATE_LABEL,
              ls.node.getFilePosition(), MessagePart.Factory.valueOf(label),
              p.node.getFilePosition());
          break;  // Since we have already seen p in buckets
        }
      }
    }
  }

  private static void checkUses(
      List<LexicalScope> scopes, LiveSet liveAtEnd, ScopeAnalyzer sa,
      Set<String> provides, Set<String> requires, Set<String> overrides,
      MessageQueue mq) {
    LexicalScope globalScope = scopes.get(0);
    // Symbols banned since they are unsafe due to differences between
    // expectations of block scoping and actual ES scoping rules.
    Map<Pair<LexicalScope, String>, LexicalScope> banned = Maps.newHashMap();
    for (LexicalScope scope : scopes) {
      if (scope.isFunctionScope() || scope.isCatchScope()
          || scope.isWithScope()) {
        continue;
      }
      for (LexicalScope p = scope;
           !p.isFunctionScope() && (p = p.parent) != null;) {
        for (String symbolName : scope.symbols.symbolNames()) {
          Pair<LexicalScope, String> symbol = Pair.pair(p, symbolName);
          if (!banned.containsKey(symbol)
              && p.symbols.getSymbol(symbolName) == null) {
            banned.put(symbol, scope);
          }
        }
      }
    }

    // Check that uses are consistent with declarations
    Set<String> undeclaredGlobals = Sets.newHashSet();
    Map<String, ScopeAnalyzer.Use> globalsRead = Maps.newHashMap();
    Map<String, ScopeAnalyzer.Use> globalsSet = Maps.newHashMap();
    Map<String, ScopeAnalyzer.Use> globalsModified = Maps.newHashMap();
    for (ScopeAnalyzer.Use use : sa.getUses(globalScope.root)) {
      String symbolName = use.getSymbolName();
      LexicalScope cscope = ScopeAnalyzer.containingScopeForNode(use.ref.node);
      LexicalScope subScopeOrigin = banned.get(Pair.pair(cscope, symbolName));
      if (subScopeOrigin != null) {
        mq.addMessage(
            LinterMessageType.OUT_OF_BLOCK_SCOPE,
            use.ref.node.getFilePosition(),
            MessagePart.Factory.valueOf(symbolName),
            (subScopeOrigin.symbols.getSymbol(symbolName).getDeclarations()
             .iterator().next().node.getFilePosition()));
        continue;
      }
      LexicalScope dscope = cscope.declaringScope(symbolName);
      boolean usedInSameProgramUnitAsDeclared
          = dscope != null && dscope.inSameProgramUnit(cscope);
      // Keep track of uses of global variables so that we can check
      // @provides and @requires later.
      if (dscope == null) {
        if (!undeclaredGlobals.contains(symbolName)) {
          mq.addMessage(
              MessageType.UNDEFINED_SYMBOL, use.ref.node.getFilePosition(),
              MessagePart.Factory.valueOf(symbolName));
          undeclaredGlobals.add(symbolName);
        }
      } else {
        if (dscope.isGlobal()) {
          Map<String, ScopeAnalyzer.Use> m = (
              !use.isLeftHandSideExpression() ? globalsRead
              : use.isMemberAccess() ? globalsModified
              : globalsSet);
          if (!m.containsKey(symbolName)) { m.put(symbolName, use); }
        }
        // Check liveness
        // Exempt assignments to variables from liveness checks.
        if (usedInSameProgramUnitAsDeclared && !(use.isLeftHandSideExpression()
            && !use.isMemberAccess())) {
          if (!(use.ref.parent.node instanceof ExpressionStmt
                && isForEachLoopKey(use.ref.parent.cast(ExpressionStmt.class)))
              ) {
            LiveSet liveAtUse = VariableLiveness.livenessFor(use.ref.node);
            if (liveAtUse != null
                && !liveAtUse.symbols.contains(Pair.pair(symbolName, dscope))) {
              mq.addMessage(
                  LinterMessageType.SYMBOL_NOT_LIVE,
                  use.ref.node.getFilePosition(),
                  MessagePart.Factory.valueOf(symbolName));
            }
          }
        }
      }
    }

    // Check @provides and @overrides against the program's free variables.
    for (String symbolName : Sets.difference(
             globalScope.symbols.symbolNames(),
             Sets.union(provides, overrides))) {
      for (AncestorChain<?> decl
           : globalScope.symbols.getSymbol(symbolName).getDeclarations()) {
        if (decl == globalScope.root) { continue; }  // a built-in
        mq.addMessage(
            MessageType.INVALID_DECLARATION,
            decl.node.getFilePosition(),
            MessagePart.Factory.valueOf(symbolName));
      }
    }
    for (String symbolName : Sets.difference(
             globalsSet.keySet(), Sets.union(provides, overrides))) {
      mq.addMessage(
          MessageType.INVALID_ASSIGNMENT,
          globalsSet.get(symbolName).ref.node.getFilePosition(),
          MessagePart.Factory.valueOf(symbolName));
    }
    for (String symbolName : Sets.difference(
             globalsModified.keySet(), Sets.union(provides, overrides))) {
      ScopeAnalyzer.Use use = globalsModified.get(symbolName);
      mq.addMessage(
          MessageType.INVALID_ASSIGNMENT, use.ref.node.getFilePosition(),
          MessagePart.Factory.valueOf(render(use.ref.parent.node)));
    }

    // Check @requires are used
    for (String symbolName : Sets.difference(requires, globalsRead.keySet())) {
      mq.addMessage(
          LinterMessageType.UNUSED_REQUIRE,
          globalScope.root.node.getFilePosition().source(),
          MessagePart.Factory.valueOf(symbolName));
    }
    // TODO(mikesamuel): check locals and formals used

    // Check that @provides are provided
    for (String symbolName : provides) {
      if (!liveAtEnd.symbols.contains(Pair.pair(symbolName, globalScope))) {
        mq.addMessage(
            LinterMessageType.UNUSED_PROVIDE,
            globalScope.root.node.getFilePosition().source(),
            MessagePart.Factory.valueOf(symbolName));
      }
    }
  }

  private static void checkSideEffects(NodeBuckets buckets, MessageQueue mq) {
    // Complain about lack of side-effects
    for (AncestorChain<ExpressionStmt> es : buckets.get(ExpressionStmt.class)) {
      if (shouldBeEvaluatedForValue(es.node.getExpression())
          && !isCommaOperatorInForLoop(es) && !isForEachLoopKey(es)) {
        mq.addMessage(MessageType.NO_SIDE_EFFECT, es.node.getFilePosition());
      }
    }
  }

  private static void checkDeadCode(NodeBuckets buckets, MessageQueue mq) {
    // Complain about lack of side-effects
    for (AncestorChain<ExpressionStmt> es : buckets.get(ExpressionStmt.class)) {
      if (VariableLiveness.livenessFor(es.node) == null) {
        // We can't do liveness checks in with blocks, so ignore statements in
        // them.
        boolean isAnalyzable = true;
        for (AncestorChain<?> p = es; p != null; p = p.parent) {
          if (p.node instanceof WithStmt) {
            isAnalyzable = false;
            break;
          }
        }
        if (isAnalyzable) {
          mq.addMessage(
              LinterMessageType.CODE_NOT_REACHABLE, es.node.getFilePosition());
        }
      }
    }
  }

  private static String render(ParseTreeNode node) {
    StringBuilder sb = new StringBuilder();
    TokenConsumer tc = node.makeRenderer(sb, null);
    node.render(new RenderContext(tc).withAsciiOnly(true).withEmbeddable(true));
    tc.noMoreTokens();
    return sb.toString();
  }

  /** Encapsulates information about a single input to the linter. */
  static final class LintJob {  // Visible for testing
    final InputSource src;
    final Set<String> requires, provides, overrides;
    final Block program;

    LintJob(InputSource src, Set<String> requires, Set<String> provides,
            Set<String> overrides, Block program) {
      this.src = src;
      this.requires = requires;
      this.provides = provides;
      this.overrides = overrides;
      this.program = program;
    }
  }

  /**
   * Find identifier lists in documentation comments.
   * Annotations in documentation comments start with a '&#64;' symbol followed
   * by annotationName.
   * The following content ends at the next '@' symbol, and is parsed as an
   * identifier list separated by spaces and/or commas.
   */
  private static final Set<String> parseIdentifierListFromComment(
      String annotationName, List<Token<JsTokenType>> comments,
      MessageQueue mq) {
    // TODO(mikesamuel): replace with jsdoc comment parser
    Set<String> idents = Sets.newLinkedHashSet();
    for (Token<JsTokenType> comment : comments) {
      // Remove line prefixes so they're not interpreted as significant in the
      // middle of an identifier list.
      // And remove trailing content that is not whitespace or commas
      String body = comment.text
          .replaceAll("\\*+/$", "")
          .replaceAll("[\r\n]+[ \t]*\\*+[ \t]?", " ");
      String annotPrefix = "@" + annotationName;
      for (int annotStart = -1;
           (annotStart = body.indexOf(annotPrefix, annotStart + 1)) >= 0;) {
        int annotBodyStart = annotStart + annotPrefix.length();
        int annotBodyEnd = body.indexOf('@', annotBodyStart);
        if (annotBodyEnd < 0) { annotBodyEnd = body.length(); }
        String annotBody = body.substring(annotBodyStart, annotBodyEnd).trim();
        if ("".equals(annotBody)) { continue; }
        // annotBody is the content of an annotation.
        for (String ident : annotBody.split("[\\s,]+")) {
          if (!ParserBase.isJavascriptIdentifier(ident)) {
            mq.addMessage(
                MessageType.INVALID_IDENTIFIER, comment.pos,
                MessagePart.Factory.valueOf(ident));
          } else {
            idents.add(ident);
          }
        }
      }
    }
    return Collections.unmodifiableSet(idents);
  }

  /**
   * A heuristic that identifies expressions that should not appear in a place
   * where their value cannot be used.  This identifies expressions that don't
   * have a side effect, or that are overly complicated.
   *
   * <p>
   * E.g. the expression {@code [1, 2, 3]} has no side effect and so should not
   * appear where its value would be ignored.
   *
   * <p>
   * The expression {@code +f()} might have a side effect, but the {@code +}
   * operator is redundant, and so the expression should not be ignored.
   *
   * <p>
   * Expressions like function calls and assignments are considered side effects
   * and can reasonably appear where their value is not used.
   *
   * <p>
   * Member access operations {@code a.b} could have a useful side-effect, but
   * are unlikely to be used that way.
   *
   * <p>
   * To convince this method that an operations value is being purposely ignored
   * use the {@code void} operator.
   *
   * @return true for any expression that is likely to be used for its value.
   */
  private static boolean shouldBeEvaluatedForValue(Expression e) {
    // A literal or value constructor
    if (e instanceof Reference || e instanceof Literal) { return true; }
    if (!(e instanceof Operation)) { return false; }
    Operation op = (Operation) e;
    switch (op.getOperator()) {
      case ASSIGN:
      case DELETE:
      case POST_DECREMENT: case POST_INCREMENT:
      case PRE_DECREMENT: case PRE_INCREMENT:
      case VOID: // indicates value purposely ignored
        return false;
      case FUNCTION_CALL:
        // new x() should be evaluated for its value, but not other calls.
        Expression left = op.children().get(0);
        return left instanceof Operation
            && Operator.CONSTRUCTOR == ((Operation) left).getOperator();
      default: return op.getOperator().getAssignmentDelegate() == null;
    }
  }

  private static boolean isCommaOperatorInForLoop(
      AncestorChain<ExpressionStmt> es) {
    if (es.parent == null || !(es.parent.node instanceof ForLoop)) {
      return false;
    }
    Expression e = es.node.getExpression();

    return isCommaOperationNotEvaluatedForValue(e);
  }

  private static boolean isForEachLoopKey(AncestorChain<ExpressionStmt> es) {
    if (es.parent == null || !(es.parent.node instanceof ForEachLoop)) {
      return false;
    }
    return es.parent.cast(ForEachLoop.class).node.getKeyReceiver() == es.node;
  }

  private static boolean isCommaOperationNotEvaluatedForValue(Expression e) {
    if (!(e instanceof Operation)) { return false; }
    Operation op = (Operation) e;
    if (op.getOperator() != Operator.COMMA) { return false; }
    Expression left = op.children().get(0), right = op.children().get(1);
    return !shouldBeEvaluatedForValue(right)
        && (!shouldBeEvaluatedForValue(left)
            || isCommaOperationNotEvaluatedForValue(left));
  }

  public static void main(String[] args) throws IOException {
    List<File> inputs = Lists.newArrayList();
    for (String arg : args) { inputs.add(new File(arg)); }
    List<File> deps = Lists.newArrayList();
    File out = File.createTempFile(Linter.class.getSimpleName(), ".stamp");
    (new Linter()).build(inputs, deps, out);
  }
}
