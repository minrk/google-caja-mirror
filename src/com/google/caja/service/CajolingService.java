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

package com.google.caja.service;

import com.google.caja.lexer.ExternalReference;
import com.google.caja.lexer.FetchedData;
import com.google.caja.lexer.FilePosition;
import com.google.caja.lexer.InputSource;
import com.google.caja.plugin.UriFetcher;
import com.google.caja.reporting.BuildInfo;
import com.google.caja.reporting.MessagePart;
import com.google.caja.reporting.MessageQueue;
import com.google.caja.util.Lists;
import com.google.caja.util.Pair;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;
import java.util.Vector;

/**
 * A cajoling service which proxies connections:<ul>
 *   <li> cajole any javascript
 *   <li> cajoles any gadgets
 *   <li> checks requested and retrieved mime-types
 * </ul>
 *
 * @author jasvir@gmail.com (Jasvir Nagra)
 */
public class CajolingService {
  static final String DEFAULT_HOST = "http://caja.appspot.com/cajole";

  private final List<ContentHandler> handlers = new Vector<ContentHandler>();
  private final ContentTypeCheck typeCheck = new LooseContentTypeCheck();
  private final String host;
  private final UriFetcher uriFetcher;

  public CajolingService() { this(BuildInfo.getInstance()); }

  public CajolingService(BuildInfo buildInfo) { this(buildInfo, null); }

  public CajolingService(BuildInfo buildInfo, String host) {
    this(buildInfo, host, new UriFetcher() {
      public FetchedData fetch(ExternalReference ref, String mimeType)
          throws UriFetchException {
        try {
          return FetchedData.fromConnection(
              ref.getUri().toURL().openConnection());
        } catch (IOException ex) {
          throw new UriFetchException(ref, mimeType, ex);
        }
      }
    });
  }

  public CajolingService(BuildInfo buildInfo, String host, UriFetcher fetcher) {
    this.host = host != null ? host : DEFAULT_HOST;
    this.uriFetcher = fetcher;
    registerHandlers(buildInfo);
  }

  /**
   * Main entry point for the cajoling service.
   *
   * @param inputFetchedData the input content. If this is {@code null}, the
   *     service will attempt to fetch the content from the location given by
   *     the {@link CajaArguments#URL} parameter.
   * @param args a set of arguments to the cajoling service.
   * @param mq a message queue into which status and error messages will be
   *     placed. The caller should query for the most severe status of the
   *     messages in this queue to determine the overall success of the
   *     invocation.
   * @return the output content, or {@code null} if a serious error occurred
   *     that prevented the content from being generated.
   */
  @SuppressWarnings("deprecation")
  public FetchedData handle(FetchedData inputFetchedData,
                            ContentHandlerArgs args,
                            MessageQueue mq) {
    String inputUrlString = CajaArguments.URL.get(args);
    URI inputUri;
    if (inputUrlString == null && inputFetchedData == null) {
      mq.addMessage(
          ServiceMessageType.MISSING_ARGUMENT,
          MessagePart.Factory.valueOf(CajaArguments.URL.toString()));
      return null;
    } else if (inputUrlString == null) {
      inputUri = InputSource.UNKNOWN.getUri();
    } else {
      try {
        inputUri = new URI(inputUrlString);
      } catch (URISyntaxException ex) {
        mq.addMessage(
            ServiceMessageType.INVALID_INPUT_URL,
            MessagePart.Factory.valueOf(inputUrlString));
        return null;
      }
    }

    String expectedInputContentType = CajaArguments.INPUT_MIME_TYPE.get(args);
    if (expectedInputContentType == null) {
      expectedInputContentType = CajaArguments.OLD_INPUT_MIME_TYPE.get(args);
    }
    if (expectedInputContentType == null) {
      mq.addMessage(
          ServiceMessageType.MISSING_ARGUMENT,
          MessagePart.Factory.valueOf(
              CajaArguments.INPUT_MIME_TYPE.toString()));
      return null;
    }

    if (inputFetchedData == null) {
      try {
        inputFetchedData = uriFetcher.fetch(
            new ExternalReference(inputUri, FilePosition.UNKNOWN),
            expectedInputContentType);
      } catch (UriFetcher.UriFetchException ex) {
        ex.toMessageQueue(mq);
        return null;
      }
    }

    if (!typeCheck.check(
            expectedInputContentType,
            inputFetchedData.getContentType())) {
      mq.addMessage(
          ServiceMessageType.UNEXPECTED_INPUT_MIME_TYPE,
          MessagePart.Factory.valueOf(expectedInputContentType),
          MessagePart.Factory.valueOf(inputFetchedData.getContentType()));
      return null;
    }

    String outputContentType = CajaArguments.OUTPUT_MIME_TYPE.get(args);
    if (outputContentType == null) {
      outputContentType = "*/*";
    }

    String transformName = CajaArguments.TRANSFORM.get(args);
    Transform transform = null;
    if (transformName != null) {
      try {
        transform = Transform.valueOf(transformName);
      } catch (Exception e) {
        mq.addMessage(
            ServiceMessageType.INVALID_ARGUMENT,
            MessagePart.Factory.valueOf(transformName),
            MessagePart.Factory.valueOf(CajaArguments.TRANSFORM.toString()));
        return null;
      }
    }

    // TODO(jasvir): Change CajaArguments to handle >1 occurrence of arg
    String directiveName = CajaArguments.DIRECTIVE.get(args);
    List<Directive> directive = Lists.newArrayList();
    if (directiveName != null) {
      try {
        directive.add(Directive.valueOf(directiveName));
      } catch (Exception e) {
        mq.addMessage(
            ServiceMessageType.INVALID_ARGUMENT,
            MessagePart.Factory.valueOf(directiveName),
            MessagePart.Factory.valueOf(CajaArguments.DIRECTIVE.toString()));
        return null;
      }
    }

    ByteArrayOutputStream intermediateResponse = new ByteArrayOutputStream();
    Pair<String, String> contentInfo;
    try {
      contentInfo = applyHandler(
          inputUri,
          transform,
          directive,
          args,
          inputFetchedData.getContentType(),
          outputContentType,
          inputFetchedData,
          intermediateResponse,
          mq);
    } catch (UnsupportedContentTypeException e) {
      mq.addMessage(ServiceMessageType.UNSUPPORTED_CONTENT_TYPES);
      return null;
    } catch (RuntimeException e) {
      mq.addMessage(
          ServiceMessageType.EXCEPTION_IN_SERVICE,
          MessagePart.Factory.valueOf(e.toString()));
      return null;
    }

    return FetchedData.fromBytes(
        intermediateResponse.toByteArray(),
        contentInfo.a,
        contentInfo.b,
        new InputSource(inputUri));
  }

  private void registerHandlers(BuildInfo buildInfo) {
    handlers.add(new JsHandler(buildInfo));
    handlers.add(new ImageHandler());
    handlers.add(new InnocentHandler());
    handlers.add(new HtmlHandler(buildInfo, host, uriFetcher));
  }

  private Pair<String, String> applyHandler(
      URI uri, Transform t, List<Directive> d, ContentHandlerArgs args,
      String inputContentType, String outputContentType,
      FetchedData input, OutputStream response, MessageQueue mq)
      throws UnsupportedContentTypeException {
    for (ContentHandler handler : handlers) {
      if (handler.canHandle(uri, t, d, inputContentType,
          outputContentType, typeCheck)) {
        return handler.apply(uri, t, d, args, inputContentType,
            outputContentType, typeCheck, input, response, mq);
      }
    }
    throw new UnsupportedContentTypeException();
  }

  public static enum Directive {
    CAJITA,
    STRICT,
    ES53;
  }

  public static enum Transform {
    INNOCENT,
    CAJOLE;
  }
}
