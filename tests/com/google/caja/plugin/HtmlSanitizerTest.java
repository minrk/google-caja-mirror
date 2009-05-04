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

package com.google.caja.plugin;

import com.google.caja.lang.html.HtmlSchema;
import com.google.caja.lexer.HtmlTokenType;
import com.google.caja.lexer.InputSource;
import com.google.caja.lexer.ParseException;
import com.google.caja.lexer.TokenConsumer;
import com.google.caja.lexer.TokenQueue;
import com.google.caja.parser.html.DomParser;
import com.google.caja.parser.html.Nodes;
import com.google.caja.render.Concatenator;
import com.google.caja.reporting.EchoingMessageQueue;
import com.google.caja.reporting.Message;
import com.google.caja.reporting.MessageContext;
import com.google.caja.reporting.MessageLevel;
import com.google.caja.reporting.MessageQueue;
import com.google.caja.reporting.RenderContext;
import com.google.caja.util.MoreAsserts;

import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.io.StringReader;
import java.net.URI;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.w3c.dom.DocumentFragment;
import org.w3c.dom.Node;

import junit.framework.TestCase;

/**
 * @author mikesamuel@gmail.com (Mike Samuel)
 */
public class HtmlSanitizerTest extends TestCase {
  private static final PrintWriter err
      = new PrintWriter(new OutputStreamWriter(System.err));
  private InputSource is;
  private MessageContext mc;
  private MessageQueue mq;

  @Override
  protected void setUp() throws Exception {
    super.setUp();
    is = new InputSource(new URI("test:///" + getName()));
    mc = new MessageContext();
    mc.addInputSource(is);
    mq = new EchoingMessageQueue(err, mc);
  }

  @Override
  protected void tearDown() throws Exception {
    super.tearDown();
    is = null;
    mc = null;
    mq = null;
    err.flush();
  }

  public void testSingleElement() throws Exception {
    assertValid(html("<br/>"), "<br />");
  }
  public void testText() throws Exception {
    assertValid(html("Hello World"), "Hello World");
  }
  public void testFormattingElement() throws Exception {
    assertValid(html("<b>Hello</b>"), "<b>Hello</b>");
  }
  public void testUnknownAttribute() throws Exception {
    assertValid(html("<b unknown=\"bogus\">Hello</b>"),
                "<b>Hello</b>",
                "WARNING: removing unknown attribute unknown on b");
  }
  public void testKnownAttribute() throws Exception {
    assertValid(html("<b id=\"bold\">Hello</b>"), "<b id=\"bold\">Hello</b>");
  }
  public void testUnknownElement() throws Exception {
    assertValid(
        html("<bogus id=\"bold\">Hello</bogus>"),
        "Hello",
        "WARNING: removing unknown tag bogus",
        "WARNING: removing attribute id when folding bogus into parent");
  }
  public void testUnknownEverything() throws Exception {
    assertValid(html("<bogus unknown=\"bogus\">Hello</bogus>"),
                  "Hello",
                  "WARNING: removing unknown tag bogus",
                  "WARNING: removing unknown attribute unknown on bogus");
  }
  public void testDisallowedElement() throws Exception {
    assertValid(html("<script>disallowed</script>"),
                  "disallowed",
                  "WARNING: removing disallowed tag script");
  }
  public void testAttributeValidity() throws Exception {
    assertValid(html("<form><input type=text></form>"),
                "<form><input type=\"text\" /></form>");
  }
  public void testAttributePatternsTagSpecific() throws Exception {
    assertValid(html("<input type=text>"), "<input type=\"text\" />");
    assertValid(html("<button type=submit>"),
                "<button type=\"submit\"></button>");
    assertValid(html("<BUTTON TYPE=SUBMIT>"),
                "<button type=\"SUBMIT\"></button>");
    assertValid(html("<button type=text>"),
                  "<button></button>",
                  "WARNING: attribute type cannot have value text");
    assertValid(html("<BUTTON TYPE=TEXT>"),
                  "<button></button>",
                  "WARNING: attribute type cannot have value TEXT");
  }
  public void testIllegalAttributeValue() throws Exception {
    assertValid(html("<form><input type=x></form>"),
                  "<form><input /></form>",
                  "WARNING: attribute type cannot have value x");
  }
  public void testDisallowedElement2() throws Exception {
    assertValid(html("<xmp>disallowed</xmp>"),
        "disallowed",
        "WARNING: removing unknown tag xmp");
  }
  public void testDisallowedElement3() throws Exception {
    assertValid(html("<meta http-equiv='refresh' content='1'/>"),
        "",
        "WARNING: removing disallowed tag meta",
        "WARNING: removing attribute content when folding meta into parent",
        "WARNING: removing attribute http-equiv when folding meta into parent");
  }
  public void testDisallowedElement4() throws Exception {
    assertValid(xml("<title>A title</title>"), "",
                "WARNING: removing disallowed tag title");
  }
  public void testElementFolding1() throws Exception {
    assertValid(xml("<body bgcolor=\"red\">Zoicks</body>"),
        "Zoicks",
        "WARNING: folding element body into parent",
        "WARNING: removing attribute bgcolor when folding body into parent");
  }
  public void testElementFolding2() throws Exception {
    assertValid(xml("<body>Zoicks</body>"),
                "Zoicks", "WARNING: folding element body into parent");
  }
  public void testElementFolding3() throws Exception {
    assertValid(xml("<html>"
                      + "<head>"
                      + "<title>Blah</title>"
                      + "<p>Foo</p>"
                      + "</head>"
                      + "<body>"
                      + "<p>One</p>"
                      + "<p styleo=\"color: red\">Two</p>"
                      + "Three"
                      + "<x>Four</x>"
                      + "</body>"
                      + "</html>"),
                      "<p>Foo</p><p>One</p><p>Two</p>ThreeFour",
                  "WARNING: folding element html into parent",
                  "WARNING: folding element head into parent",
                  "WARNING: removing disallowed tag title",
                  "WARNING: folding element body into parent",
                  "WARNING: removing unknown attribute styleo on p",
                  "WARNING: removing unknown tag x");
  }
  public void testElementFolding4() throws Exception {
    assertValid(xml("<html>"
                    + "<head>"
                    + "<title>Blah</title>"
                    + "<p>Foo</p>"
                    + "</head>"
                    + "<body>"
                    + "<p>One</p>"
                    + "<p>Two</p>"
                    + "Three"
                    + "<p>Four</p>"
                    + "</body>"
                    + "</html>"),
                "<p>Foo</p><p>One</p><p>Two</p>Three<p>Four</p>",
                "WARNING: folding element html into parent",
                "WARNING: folding element head into parent",
                "WARNING: removing disallowed tag title",
                "WARNING: folding element body into parent");
  }
  public void testIgnoredElement() throws Exception {
    assertValid(
        html("<p>Foo"
             + "<noscript>ignorable</noscript>"
             + "<p>Bar"),
        "<p>Foo</p><p>Bar</p>",
        "WARNING: removing disallowed tag noscript");
  }
  public void testDupeAttrs() throws Exception {
    assertValid(
        xml("<font color=\"red\" color=\"blue\">Purple</font>"),
        //         ^^^^^
        //            1
        //   123456789012
        "<font color=\"red\">Purple</font>",
        "WARNING: attribute color duplicates one at testDupeAttrs:1+7 - 12");
  }
  public void testDisallowedAttrs() throws Exception {
    assertValid(
        html("<a href=\"foo.html\" charset=\"utf-7\">foo</a>"),
        "<a href=\"foo.html\">foo</a>",
        "WARNING: removing disallowed attribute charset on tag a");
  }

  private void assertValid(Node input, String golden, String... warnings)
      throws Exception {
    sanitize(input, golden, true, warnings);
  }

  private void sanitize(
      Node input, String golden, boolean valid, String... warnings)
      throws Exception {
    boolean validated = new HtmlSanitizer(HtmlSchema.getDefault(mq), mq)
        .sanitize(input);

    List<String> actualWarnings = new ArrayList<String>();
    for (Message msg : mq.getMessages()) {
      if (MessageLevel.WARNING.compareTo(msg.getMessageLevel()) <= 0) {
        String msgText = msg.format(mc);
        msgText = msgText.substring(msgText.indexOf(": ") + 1);
        actualWarnings.add(msg.getMessageLevel().name() + ":" + msgText);
      }
    }
    mq.getMessages().clear();
    MoreAsserts.assertListsEqual(Arrays.asList(warnings), actualWarnings);

    assertEquals(valid, validated);

    if (golden != null) {
      StringBuilder sb = new StringBuilder();
      TokenConsumer tc = new Concatenator(sb, null);
      Nodes.render(input, new RenderContext(tc));
      assertEquals(golden, sb.toString());
    }
  }

  private DocumentFragment html(String html) throws ParseException {
    return parse(html, false);
  }

  private DocumentFragment xml(String xml) throws ParseException {
    return parse(xml, true);
  }

  private DocumentFragment parse(String markup, boolean asXml) throws ParseException {
    TokenQueue<HtmlTokenType> tq;
    try {
      tq = DomParser.makeTokenQueue(is, new StringReader(markup), asXml);
    } catch (IOException ex) {
      throw new RuntimeException(ex);  // IOException reading from string.
    }
    DocumentFragment t = new DomParser(tq, asXml, mq).parseFragment(
        DomParser.makeDocument(null, null));
    tq.expectEmpty();
    return t;
  }
}
