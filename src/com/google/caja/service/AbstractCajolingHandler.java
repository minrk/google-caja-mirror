// Copyright 2010 Google Inc. All Rights Reserved.
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

package com.google.caja.service;

import java.io.IOException;
import java.io.OutputStream;
import java.net.URI;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import com.google.caja.lexer.CharProducer;
import com.google.caja.lexer.InputSource;
import com.google.caja.lexer.JsLexer;
import com.google.caja.lexer.JsTokenQueue;
import com.google.caja.lexer.ParseException;
import com.google.caja.lexer.TokenConsumer;
import com.google.caja.parser.ParseTreeNode;
import com.google.caja.parser.js.Identifier;
import com.google.caja.parser.js.Parser;
import com.google.caja.parser.js.Reference;
import com.google.caja.parser.quasiliteral.QuasiBuilder;
import com.google.caja.render.JsMinimalPrinter;
import com.google.caja.render.JsPrettyPrinter;
import com.google.caja.reporting.SimpleMessageQueue;
import com.google.caja.util.ContentType;
import com.google.caja.util.Maps;
import org.w3c.dom.Node;

import com.google.caja.lexer.ExternalReference;
import com.google.caja.lexer.FetchedData;
import com.google.caja.lexer.FilePosition;
import com.google.caja.lexer.escaping.UriUtil;
import com.google.caja.parser.html.Nodes;
import com.google.caja.parser.js.ArrayConstructor;
import com.google.caja.parser.js.Expression;
import com.google.caja.parser.js.IntegerLiteral;
import com.google.caja.parser.js.ObjectConstructor;
import com.google.caja.parser.js.StringLiteral;
import com.google.caja.parser.js.ValueProperty;
import com.google.caja.plugin.LoaderType;
import com.google.caja.plugin.UriEffect;
import com.google.caja.plugin.UriFetcher;
import com.google.caja.plugin.UriPolicy;
import com.google.caja.render.Concatenator;
import com.google.caja.reporting.BuildInfo;
import com.google.caja.reporting.Message;
import com.google.caja.reporting.MessageLevel;
import com.google.caja.reporting.MessageQueue;
import com.google.caja.reporting.RenderContext;
import com.google.caja.util.Callback;
import com.google.caja.util.Lists;
import com.google.caja.util.Pair;
import com.google.caja.util.Strings;

/**
 * Common parent class for handlers that invoke the cajoler
 * and render the result
 *
 * @author jasvir@google.com (Jasvir Nagra)
 */
public abstract class AbstractCajolingHandler implements ContentHandler {
  protected final BuildInfo buildInfo;
  protected final UriFetcher uriFetcher;
  protected final String hostedService;

  public AbstractCajolingHandler(
      BuildInfo buildInfo, String hostedService, UriFetcher uriFetcher) {
    this.buildInfo = buildInfo;
    this.hostedService = hostedService;
    this.uriFetcher = uriFetcher != null ? uriFetcher : UriFetcher.NULL_NETWORK;
  }

  protected UriPolicy makeUriPolicy(final ContentHandlerArgs args) {
    return new UriPolicy() {
      public String rewriteUri(
          ExternalReference u, UriEffect effect, LoaderType loader,
          Map<String, ?> hints) {
        URI uri = u.getUri();
        boolean sandboxLinksAndImages = !"false".equals(args.get("sext"));
        if (((effect == UriEffect.NEW_DOCUMENT
              && loader == LoaderType.UNSANDBOXED)
             || (effect == UriEffect.SAME_DOCUMENT
                 && loader == LoaderType.SANDBOXED))
            && !sandboxLinksAndImages) {
          String protocol = Strings.toLowerCase(uri.getScheme());
          if ("http".equals(protocol) || "https".equals(protocol)) {
            return uri.toString();
          }
        }
        if (hostedService != null) {
          return hostedService
              + "?url=" + UriUtil.encode(uri.toString())
              + "&effect=" + effect + "&loader=" + loader
              + "&sext=" + sandboxLinksAndImages;
        } else {
          return null;
        }
      }
    };
  }

  public abstract boolean canHandle(URI uri,
      CajolingService.Transform transform,
      List<CajolingService.Directive> directives,
      String inputContentType,
      ContentTypeCheck checker);

  public abstract Pair<String,String> apply(URI uri,
      CajolingService.Transform transform,
      List<CajolingService.Directive> directives,
      ContentHandlerArgs args,
      String inputContentType,
      ContentTypeCheck checker,
      FetchedData input,
      OutputStream response,
      MessageQueue mq)
      throws UnsupportedContentTypeException;

  private static StringLiteral lit(String s) {
    return StringLiteral.valueOf(FilePosition.UNKNOWN, s);
  }

  private static IntegerLiteral lit(int i) {
    return new IntegerLiteral(FilePosition.UNKNOWN, i);
  }

  private static ArrayConstructor arr(List<? extends Expression> items) {
    return new ArrayConstructor(FilePosition.UNKNOWN, items);
  }

  private static ObjectConstructor obj(List<? extends ValueProperty> props) {
    return new ObjectConstructor(FilePosition.UNKNOWN, props);
  }

  private static ValueProperty prop(String key, Expression e) {
    return new ValueProperty(FilePosition.UNKNOWN, lit(key), e);
  }

  /**
   * Checks whether a string is a JavaScript Identifier.
   */
  /* visible for testing */ static boolean checkIdentifier(String candidate) {
    // Using a simple regex is possible if we reject anything but 7-bit ASCII.
    // However, this implementation ensures Caja has a single point of truth
    // regarding what constitutes a JS identifier.
    MessageQueue mq = new SimpleMessageQueue();
    Parser parser = new Parser(
        new JsTokenQueue(
            new JsLexer(
                CharProducer.Factory.fromString(
                    "var " + candidate + ";",
                    InputSource.UNKNOWN)),
            InputSource.UNKNOWN),
        mq);
    ParseTreeNode node;
    try { node = parser.parse(); } catch (ParseException e) { return false; }
    if (node == null || !mq.getMessages().isEmpty()) { return false; }
    Map<String, ParseTreeNode> bindings = Maps.newHashMap();
    if (!QuasiBuilder.match("{ var @p; }", node, bindings)) { return false; }
    if (bindings.size() != 1) { return false; }
    if (bindings.get("p") == null) { return false; }
    if (!(bindings.get("p") instanceof Identifier)) { return false; }
    Identifier p = (Identifier) bindings.get("p");
    if (!candidate.equals(p.getName())) { return false; }
    return true;
  }

  private static class IOCallback implements Callback<IOException> {
    public IOException ex = null;
    public void handle(IOException e) {
      if (this.ex != null) { this.ex = e; }
    }
  }

  protected static void renderAsJSON(
      Node staticHtml,
      ParseTreeNode javascript,
      String jsonpCallback,
      MessageQueue mq,
      Appendable output,
      boolean pretty)
      throws IOException {
    List<ValueProperty> props = Lists.newArrayList();

    if (staticHtml != null) {
      props.add(prop("html", lit(Nodes.render(staticHtml))));
    }
    if (javascript != null) {
      props.add(prop("js", lit(renderJavascript(javascript, pretty))));
    }
    if (mq.hasMessageAtLevel(MessageLevel.LOG)) {
      List<Expression> messages = Lists.newArrayList();
      for (Message m : mq.getMessages()) {
        messages.add(obj(Arrays.asList(
            prop("level", lit(m.getMessageLevel().ordinal())),
            prop("name", lit(m.getMessageLevel().name())),
            prop("type", lit(m.getMessageType().name())),
            prop("message", lit(m.toString())))));
      }
      props.add(prop("messages", arr(messages)));
    }

    if (jsonpCallback != null && !checkIdentifier(jsonpCallback)) {
      throw new RuntimeException("Detected XSS attempt; aborting request");
    }

    ParseTreeNode result = (jsonpCallback == null)
        ? obj(props)
        : QuasiBuilder.substV("@c(@o);",
            "c", new Reference(
                     new Identifier(
                         FilePosition.UNKNOWN,
                         jsonpCallback)),
            "o", obj(props));

    IOCallback callback = new IOCallback();
    RenderContext rc = makeRenderContext(output, callback, pretty, false, true);
    result.render(rc);
    rc.getOut().noMoreTokens();
    if (callback.ex != null) { throw callback.ex; }
  }

  private static String renderJavascript(
      ParseTreeNode javascript, boolean pretty)
      throws IOException {
    StringBuilder jsOut = new StringBuilder();
    IOCallback callback = new IOCallback();
    RenderContext rc = makeRenderContext(jsOut, callback, pretty, true, false);
    javascript.render(rc);
    rc.getOut().noMoreTokens();
    if (callback.ex != null) { throw callback.ex; }
    return jsOut.toString();
  }

  private static RenderContext makeRenderContext(
      Appendable a, IOCallback cb,
      boolean pretty,
      boolean embeddable,
      boolean json) {
    TokenConsumer tc = pretty
        ? new JsPrettyPrinter(new Concatenator(a, cb))
        : new JsMinimalPrinter(new Concatenator(a, cb));
    return new RenderContext(tc).withEmbeddable(embeddable).withJson(json);
  }

  protected static Pair<ContentType, String> getReturnedContentParams(
      ContentHandlerArgs args) {
    String alt = CajaArguments.ALT.get(args);
    if ("json".equals(alt) || alt == null) {
      return Pair.pair(ContentType.JSON, null);
    } else if ("json-in-script".equals(alt)) {
      String callback = CajaArguments.CALLBACK.get(args);
      if (callback == null) {
        throw new RuntimeException(
            "Missing value for parameter " + CajaArguments.CALLBACK);
      } else {
        return Pair.pair(ContentType.JS, callback);
      }
    } else {
      throw new RuntimeException(
          "Invalid value " + alt + " for parameter " + CajaArguments.ALT);
    }
  }
}
