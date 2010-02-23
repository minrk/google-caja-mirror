// Copyright 2009 Google Inc. All Rights Reserved.
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

import com.google.caja.lexer.CharProducer;
import com.google.caja.lexer.ExternalReference;
import com.google.caja.lexer.HtmlLexer;
import com.google.caja.lexer.InputSource;
import com.google.caja.lexer.ParseException;
import com.google.caja.lexer.escaping.UriUtil;
import com.google.caja.parser.AncestorChain;
import com.google.caja.parser.html.Dom;
import com.google.caja.parser.html.DomParser;
import com.google.caja.parser.html.Namespaces;
import com.google.caja.parser.html.Nodes;
import com.google.caja.parser.js.CajoledModule;
import com.google.caja.parser.js.Expression;
import com.google.caja.parser.quasiliteral.QuasiBuilder;
import com.google.caja.plugin.PipelineMaker;
import com.google.caja.plugin.PluginCompiler;
import com.google.caja.plugin.PluginEnvironment;
import com.google.caja.plugin.PluginMeta;
import com.google.caja.render.Concatenator;
import com.google.caja.render.JsMinimalPrinter;
import com.google.caja.reporting.BuildInfo;
import com.google.caja.reporting.MessagePart;
import com.google.caja.reporting.MessageQueue;
import com.google.caja.reporting.RenderContext;
import com.google.caja.util.ContentType;
import com.google.caja.util.Pair;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Reader;
import java.net.URI;
import java.util.List;

/**
 * Retrieves html files and cajoles them
 *
 * @author jasvir@google.com (Jasvir Nagra)
 */
public class HtmlHandler implements ContentHandler {
  private final BuildInfo buildInfo;
  private final PluginEnvironment pluginEnvironment;

  public HtmlHandler(
      BuildInfo buildInfo, final String hostedService,
      final PluginEnvironment retriever) {
    this.buildInfo = buildInfo;
    this.pluginEnvironment = new PluginEnvironment() {
      public CharProducer loadExternalResource(
          ExternalReference ref, String mimeType) {
        return retriever != null
            ? retriever.loadExternalResource(ref, mimeType)
            : null;
      }

      public String rewriteUri(ExternalReference uri, String mimeType) {
        if (hostedService != null) {
          return hostedService
              + "?url=" + UriUtil.encode(uri.getUri().toString())
              + "&input-mime-type=" + UriUtil.encode(mimeType);
        } else {
          return null;
        }
      }
    };
  }

  public boolean canHandle(URI uri, CajolingService.Transform transform,
      List<CajolingService.Directive> directives,
      String inputContentType, String outputContentType,
      ContentTypeCheck checker) {
    return checker.check("text/html", inputContentType)
        && (checker.check(outputContentType, "text/html")
            || checker.check(outputContentType, "*/*")
            || checker.check(outputContentType, "text/javascript"));
  }

  public Pair<String,String> apply(URI uri,
                                   CajolingService.Transform transform,
                                   List<CajolingService.Directive> directives,
                                   ContentHandlerArgs args,
                                   String inputContentType,
                                   String outputContentType,
                                   ContentTypeCheck checker,
                                   String charset,
                                   byte[] content,
                                   OutputStream response,
                                   MessageQueue mq)
      throws UnsupportedContentTypeException {
    PluginMeta meta = new PluginMeta(pluginEnvironment);
    ContentType outputType = ContentType.fromMimeType(outputContentType);
    if (outputType == null) {
      if (outputContentType.matches("\\*/\\*(\\s*;.*)?")) {
        outputType = ContentType.HTML;
      } else {
        throw new UnsupportedContentTypeException(outputContentType);
      }
    } else {
      switch (outputType) {
        case JS: case HTML: break;
        default:
          throw new UnsupportedContentTypeException(outputContentType);
      }
    }

    String moduleCallbackString = CajaArguments.MODULE_CALLBACK.get(args);
    Expression moduleCallback = (Expression)
        (moduleCallbackString == null
            ? null
            : QuasiBuilder.substV(moduleCallbackString));

    try {
      OutputStreamWriter writer = new OutputStreamWriter(response, "UTF-8");
      cajoleHtml(
          uri,
          new InputStreamReader(new ByteArrayInputStream(content), charset),
          meta, moduleCallback, outputType, writer, mq);
      writer.flush();
    } catch (IOException e) {
      // TODO(mikesamuel): this is not a valid assumption.
      throw new UnsupportedContentTypeException();
    }

    return new Pair<String, String>(outputType.mimeType, "UTF-8");
  }

  private void cajoleHtml(URI inputUri, Reader cajaInput, PluginMeta meta,
                          Expression moduleCallback, ContentType outputType,
                          Appendable output, MessageQueue mq)
      throws IOException, UnsupportedContentTypeException {
    InputSource is = new InputSource (inputUri);
    CharProducer cp = CharProducer.Factory.create(cajaInput,is);
    boolean okToContinue = true;
    try {
      DomParser p = new DomParser(new HtmlLexer(cp), is, mq);
      if (p.getTokenQueue().isEmpty()) { okToContinue = false; }

      Dom html = new Dom(p.parseFragment());
      Document doc = html.getValue().getOwnerDocument();
      p.getTokenQueue().expectEmpty();

      PluginCompiler compiler = new PluginCompiler(buildInfo, meta, mq);
      if (outputType == ContentType.JS) {
        compiler.setGoals(
            compiler.getGoals().without(PipelineMaker.HTML_SAFE_STATIC));
      }

      compiler.addInput(AncestorChain.instance(html), inputUri);
      if (okToContinue) {
        okToContinue &= compiler.run();
      }
      if (okToContinue) {
        if (outputType == ContentType.JS) {
          renderAsJavascript(compiler.getJavascript(),
                             moduleCallback,
                             output);
        } else {
          assert outputType == ContentType.HTML;
          renderAsHtml(doc,
                       compiler.getStaticHtml(),
                       compiler.getJavascript(),
                       moduleCallback,
                       output);
        }
      }
    } catch (ParseException e) {
      e.toMessageQueue(mq);
    } catch (IOException e) {
      mq.addMessage(
          ServiceMessageType.IO_ERROR,
          MessagePart.Factory.valueOf(e.getMessage()));
    }
  }

  private void renderAsHtml(Document doc,
                            Node staticHtml,
                            CajoledModule javascript,
                            Expression moduleCallback,
                            Appendable output)
      throws IOException {
    if (staticHtml != null) {
      output.append(Nodes.render(staticHtml));
    }
    if (javascript != null) {
      String htmlNs = Namespaces.HTML_NAMESPACE_URI;
      Element script = doc.createElementNS(htmlNs, "script");
      script.setAttributeNS(htmlNs, "type", "text/javascript");
      script.appendChild(doc.createTextNode(
          renderJavascript(javascript, moduleCallback)));
      output.append(Nodes.render(script));
    }
  }

  private void renderAsJavascript(CajoledModule javascript,
                                  Expression moduleCallback,
                                  Appendable output)
      throws IOException {
    output.append(renderJavascript(javascript, moduleCallback));
  }

  private String renderJavascript(CajoledModule javascript,
                                  Expression moduleCallback) {
    StringBuilder jsOut = new StringBuilder();
    RenderContext rc = new RenderContext(
        new JsMinimalPrinter(new Concatenator(jsOut)))
        .withEmbeddable(true);
    javascript.render(moduleCallback, rc);
    rc.getOut().noMoreTokens();
    return jsOut.toString();
  }
}
