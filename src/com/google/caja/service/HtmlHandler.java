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

import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URLEncoder;
import java.util.List;

import com.google.caja.SomethingWidgyHappenedError;
import com.google.caja.lexer.CharProducer;
import com.google.caja.lexer.FetchedData;
import com.google.caja.lexer.HtmlLexer;
import com.google.caja.lexer.InputSource;
import com.google.caja.lexer.ParseException;
import com.google.caja.parser.html.Dom;
import com.google.caja.parser.html.DomParser;
import com.google.caja.plugin.PipelineMaker;
import com.google.caja.plugin.PluginCompiler;
import com.google.caja.plugin.PluginMeta;
import com.google.caja.plugin.UriFetcher;
import com.google.caja.reporting.BuildInfo;
import com.google.caja.reporting.MessagePart;
import com.google.caja.reporting.MessageQueue;
import com.google.caja.util.Charsets;
import com.google.caja.util.ContentType;
import com.google.caja.util.Pair;

/**
 * Retrieves html files and cajoles them
 *
 * @author jasvir@google.com (Jasvir Nagra)
 */
public class HtmlHandler extends AbstractCajolingHandler {

  public HtmlHandler(
      BuildInfo buildInfo, final String hostedService, UriFetcher uriFetcher) {
    super(buildInfo, hostedService, uriFetcher);
  }

  @Override
  public boolean canHandle(URI uri, CajolingService.Transform transform,
      List<CajolingService.Directive> directives,
      String inputContentType,
      ContentTypeCheck checker) {
    return checker.check("text/html", inputContentType)
        && (transform == null || transform == CajolingService.Transform.CAJOLE);
  }

  @Override
  public Pair<String,String> apply(URI uri,
                                   CajolingService.Transform transform,
                                   List<CajolingService.Directive> directives,
                                   ContentHandlerArgs args,
                                   String inputContentType,
                                   ContentTypeCheck checker,
                                   FetchedData input,
                                   OutputStream response,
                                   MessageQueue mq)
      throws UnsupportedContentTypeException {
    PluginMeta meta = new PluginMeta(uriFetcher, makeUriPolicy(args));
    meta.setIdClass(args.get("idclass"));
    meta.setEnableES53(directives.contains(CajolingService.Directive.ES53));

    boolean htmlInline =
        CajaArguments.EMIT_HTML_IN_JS.get(args) != null
        && Boolean.valueOf(CajaArguments.EMIT_HTML_IN_JS.get(args));

    boolean pretty = CajolingService.RENDER_PRETTY.equals(
        CajaArguments.RENDERER.get(args));

    Pair<ContentType, String> contentParams = getReturnedContentParams(args);

    try {
      OutputStreamWriter writer = new OutputStreamWriter(
          response, Charsets.UTF_8);
      cajoleHtml(
          uri, input.getTextualContent(),
          meta, contentParams.b, htmlInline, writer, pretty, mq);
      writer.flush();
    } catch (IOException e) {
      // TODO(mikesamuel): this is not a valid assumption.
      throw new UnsupportedContentTypeException();
    }

    return Pair.pair(contentParams.a.mimeType, Charsets.UTF_8.name());
  }

  private void cajoleHtml(URI inputUri, CharProducer cp, PluginMeta meta,
                          String jsonpCallback,
                          boolean htmlInline, Appendable output,
                          boolean pretty, MessageQueue mq) {
    PluginCompiler compiler = null;
    boolean okToContinue = true;

    try {
      InputSource is = new InputSource (inputUri);
      compiler = new PluginCompiler(buildInfo, meta, mq);

      if (htmlInline) {
        compiler.setGoals(
            compiler.getGoals().without(PipelineMaker.HTML_SAFE_STATIC));
      }

      Dom html = null;
      try {
        DomParser p = new DomParser(new HtmlLexer(cp), false, is, mq);
        html = new Dom(p.parseFragment());
        p.getTokenQueue().expectEmpty();
      } catch (ParseException e) {
        okToContinue = false;
      }

      if (okToContinue) {
        compiler.addInput(html, inputUri);
        okToContinue &= compiler.run();
      }
    } catch (Exception e) {
      mq.addMessage(ServiceMessageType.EXCEPTION_IN_SERVICE,
          MessagePart.Factory.valueOf(e.getMessage()));
      okToContinue = false;
    }

    try {
      if (okToContinue && compiler != null) {
        renderAsJSON(
            compiler.getStaticHtml(),
            compiler.getJavascript(),
            jsonpCallback, mq, output, pretty);
      } else {
        renderAsJSON(
            null,
            null,
            jsonpCallback, mq, output, pretty);
      }
    } catch (IOException e) {
      throw new RuntimeException(e);
    }
  }

  public boolean sandboxLinksAndImages(URI inputUri) {
    return !(hasParameter(inputUri.getRawQuery(), "sext=false"));
  }

  private static boolean hasParameter(String query, String param) {
    if (query == null) { return false; }
    int pos = 0;
    int n = query.length();
    if (n >= 1 && query.charAt(0) == '?') { pos = 1; }
    while (pos < n) {
      int end = query.indexOf('&', pos);
      if (end < 0) { end = n; }
      String rawParam = query.substring(pos, end);
      try {
        if (URLEncoder.encode(rawParam, "UTF-8").equals(param)) {
          return true;
        }
      } catch (UnsupportedEncodingException ex) {
        throw new SomethingWidgyHappenedError(ex);
      }
      pos = end + 1;
    }
    return false;
  }
}
