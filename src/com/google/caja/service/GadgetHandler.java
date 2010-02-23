// Copyright 2007 Google Inc. All Rights Reserved.
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
import com.google.caja.lexer.InputSource;
import com.google.caja.lexer.ParseException;
import com.google.caja.lexer.escaping.UriUtil;
import com.google.caja.opensocial.DefaultGadgetRewriter;
import com.google.caja.opensocial.GadgetRewriteException;
import com.google.caja.plugin.PluginEnvironment;
import com.google.caja.reporting.MessageQueue;
import com.google.caja.reporting.BuildInfo;
import com.google.caja.util.Pair;

import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.StringReader;
import java.net.URI;
import java.util.List;

public class GadgetHandler implements ContentHandler {
  private final BuildInfo buildInfo;
  private final PluginEnvironment retriever;

  public GadgetHandler(BuildInfo buildInfo, PluginEnvironment retriever) {
    this.buildInfo = buildInfo;
    this.retriever = retriever;
  }

  public boolean canHandle(URI uri, CajolingService.Transform transform,
      List<CajolingService.Directive> directives,
      String inputContentType, String outputContentType,
      ContentTypeCheck checker) {
    return checker.check("application/xml", inputContentType)
        && checker.check(outputContentType, "text/javascript");
  }

  public Pair<String, String> apply(URI uri,
                                    CajolingService.Transform trans,
                                    List<CajolingService.Directive> d,
                                    ContentHandlerArgs args,
                                    String inputContentType,
                                    String outputContentType,
                                    ContentTypeCheck checker,
                                    String charSet,
                                    byte[] content,
                                    OutputStream response,
                                    MessageQueue mq)
      throws UnsupportedContentTypeException {
    try {
      OutputStreamWriter writer = new OutputStreamWriter(response, "UTF-8");
      cajoleGadget(uri, new String(content, charSet), writer, mq);
      writer.flush();
      return new Pair<String, String>("text/javascript", "UTF-8");
    } catch (ParseException e) {
      e.printStackTrace();
      throw new UnsupportedContentTypeException();
    } catch (IllegalArgumentException e) {
      e.printStackTrace();
      throw new UnsupportedContentTypeException();
    } catch (IOException e) {
      e.printStackTrace();
      throw new UnsupportedContentTypeException();
    } catch (GadgetRewriteException e) {
      e.printStackTrace();
      throw new UnsupportedContentTypeException();
    }
  }

  private void cajoleGadget(URI inputUri, String cajaInput, Appendable output,
                            MessageQueue mq)
      throws ParseException, GadgetRewriteException, IOException {
    DefaultGadgetRewriter rewriter = new DefaultGadgetRewriter(buildInfo, mq);

    PluginEnvironment env = new PluginEnvironment() {
      public CharProducer loadExternalResource(
          ExternalReference extref, String mimeType) {
        return retriever != null
            ? retriever.loadExternalResource(extref, mimeType) : null;
      }

      public String rewriteUri(ExternalReference extref, String mimeType) {
        return (
            "http://localhost:8887/?url="
            + UriUtil.encode(extref.getUri().toString())
            + "&mime-type=" + UriUtil.encode(mimeType));
      }
    };

    CharProducer p = CharProducer.Factory.create(
        new StringReader(cajaInput), new InputSource(inputUri));
    rewriter.rewrite(inputUri, p, env, "canvas", output);
  }
}
