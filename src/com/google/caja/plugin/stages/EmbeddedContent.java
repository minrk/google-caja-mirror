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

package com.google.caja.plugin.stages;

import com.google.caja.SomethingWidgyHappenedError;
import com.google.caja.lexer.CharProducer;
import com.google.caja.lexer.ExternalReference;
import com.google.caja.lexer.FilePosition;
import com.google.caja.lexer.ParseException;
import com.google.caja.parser.ParseTreeNode;
import com.google.caja.parser.css.CssParser;
import com.google.caja.parser.css.CssTree;
import com.google.caja.parser.js.Block;
import com.google.caja.parser.js.Parser;
import com.google.caja.plugin.UriFetcher;
import com.google.caja.reporting.MessageQueue;
import com.google.caja.util.ContentType;
import com.google.caja.util.Function;

import java.net.URI;
import java.util.Collections;

import org.w3c.dom.Node;

/**
 * Content in another language extracted from an HTML document.
 *
 * @author mikesamuel@gmail.com
 */
public final class EmbeddedContent {
  private final HtmlEmbeddedContentFinder finder;
  private final FilePosition pos;
  private final Function<UriFetcher, CharProducer> getter;
  private final ExternalReference contentLocation;
  private final Scheduling scheduling;
  private final Node source;
  private final ContentType type;

  EmbeddedContent(
      HtmlEmbeddedContentFinder finder, FilePosition pos,
      Function<UriFetcher, CharProducer> getter,
      ExternalReference contentLocation, Scheduling scheduling,
      Node source, ContentType type) {
    this.finder = finder;
    this.pos = pos;
    this.getter = getter;
    this.scheduling = scheduling;
    this.contentLocation = contentLocation;
    this.source = source;
    this.type = type;
  }

  public URI getBaseUri() {
    return contentLocation != null
        ? contentLocation.getUri() : finder.getBaseUri();
  }
  public FilePosition getPosition() { return pos; }
  /**
   * The message queue associated with the HtmlEmbeddedContentFinder that
   * creates this instance will receive a message if fetching external content
   * failed.
   * In this case, content will be returned that is semantically equivalent,
   * such as code to raise a JS exception to trigger <tt>onerror</tt>
   * handlers.
   */
  public CharProducer getContent(UriFetcher env) {
    return getter.apply(env);
  }
  /** Non null for remote content. */
  public ExternalReference getContentLocation() { return contentLocation; }
  public boolean isDeferredOrAsync() {
    switch (scheduling) {
      case DEFERRED: case ASYNC: return true;
      case NORMAL: return false;
    }
    throw new AssertionError("Missing case " + scheduling);
  }
  public Node getSource() { return source; }
  /**
   * Returns a parse tree node containing the content.  For content from
   * elements this does not include any information from modifying attributes
   * such as the <tt>media</tt> attribute on {@code <link>} and
   * {@code <style>} elements.
   * @param mq receives messages about parsing problems but not about
   *     content fetching.
   */
  public ParseTreeNode parse(UriFetcher fetcher, MessageQueue mq)
      throws ParseException {
    if (type == null) { return null; }  // Malformed content
    CharProducer cp = getContent(fetcher);
    FilePosition p = cp.filePositionForOffsets(cp.getOffset(), cp.getLimit());
    switch (type) {
      case JS: {
        Parser parser = finder.makeJsParser(cp, mq);
        if (parser.getTokenQueue().isEmpty()) { return new Block(p); }
        return parser.parse();
      }
      case CSS: {
        CssParser parser = finder.makeCssParser(cp, mq);
        if (source.getNodeType() == Node.ELEMENT_NODE) {
          if (parser.getTokenQueue().isEmpty()) {
            return new CssTree.StyleSheet(
                p, Collections.<CssTree.CssStatement>emptyList());
          }
          return parser.parseStyleSheet();
        } else {
          if (parser.getTokenQueue().isEmpty()) {
            return new CssTree.DeclarationGroup(
                p, Collections.<CssTree.Declaration>emptyList());
          }
          return parser.parseDeclarationGroup();
        }
      }
      default: throw new SomethingWidgyHappenedError(type.toString());
    }
  }
  /** Null for bad content. */
  public ContentType getType() { return type; }

  /**
   * Describes how loading of embedded content affects the interpretation of
   * page content.
   */
  public enum Scheduling {
    /**
     * Any side-effects that might affect the interpretation of subsequent page
     * content must occur before parsing precedes past the point at which the
     * content was embedded.
     */
    NORMAL,
    /**
     * Loaded out of band but must execute in-order with other deferred
     * scripts.
     */
    DEFERRED,
    /**
     * Loaded out of band and side-effects can be executed whenever the
     * loading document's event loop is free.
     */
    ASYNC,
    ;
  }
}
