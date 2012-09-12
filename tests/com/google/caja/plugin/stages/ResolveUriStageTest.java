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

import com.google.caja.lang.html.HtmlSchema;
import com.google.caja.plugin.Jobs;
import com.google.caja.util.ContentType;

public class ResolveUriStageTest extends PipelineStageTestCase {

  public final void testEmptyDoc() throws Exception {
    assertPipeline(
        job("", ContentType.HTML),
        htmlJobBody(""));
  }

  public final void testLink() throws Exception {
    assertPipeline(
        job("<a href=foo.html>foo</a>", ContentType.HTML),
        htmlJobBody("<a href=\"http://example.org/foo.html\">foo</a>"));
  }

  public final void testAnchorOnly() throws Exception {
    assertPipeline(
        job("<a href=#bar>foo</a>", ContentType.HTML),
        htmlJobBody("<a href=\"#bar\">foo</a>"));
  }

  public final void testLinkWithAnchor() throws Exception {
    assertPipeline(
        job("<a href=foo.html#bar>foo</a>", ContentType.HTML),
        htmlJobBody("<a href=\"http://example.org/foo.html#bar\">foo</a>"));
  }

  public final void testLinkWithBase() throws Exception {
    assertPipeline(
        job("<base href=http://example.org/bar/baz/foo.html>"
            + "<a href=../boo.html>foo</a>",
            ContentType.HTML),
        job("<html><head>"
            + "<base href=\"http://example.org/bar/baz/foo.html\" />"
            + "</head><body>"
            + "<a href=\"http://example.org/bar/boo.html\">foo</a>"
            + "</body></html>",
            ContentType.HTML));
  }

  public final void testUnresolvableUrl() throws Exception {
    assertPipeline(
        job("<base href=http://example.org/bar/baz/foo.html>"
            + "<a href=../../../../boo.html>foo</a>",
            ContentType.HTML),
        job("<html><head>"
        	+ "<base href=\"http://example.org/bar/baz/foo.html\" />"
            + "</head><body>"
            + "<a href=\"../../../../boo.html\">foo</a>"
            + "</body></html>",
            ContentType.HTML));
  }

  public final void testMalformedUrl() throws Exception {
    assertPipeline(
        job("<a href='foo bar'>foo</a>",
            ContentType.HTML),
        htmlJobBody("<a href=\"http://example.org/foo%20bar\">foo</a>"));
  }

  public final void testOpaqueUrl() throws Exception {
    assertPipeline(
        job("<a href=mailto:bob@example.com>foo</a>",
            ContentType.HTML),
        htmlJobBody("<a href=\"mailto:bob%40example.com\">foo</a>"));
  }

  public final void testJavascriptUrl() throws Exception {
    assertPipeline(
        job("<a href='javascript:foo() + bar([1, 2, 3]) * 4'>foo</a>",
            ContentType.HTML),
        htmlJobBody("<a href=\"javascript:"
            + "foo%28%29%20+%20bar%28%5b1,%202,%203%5d%29%20%2a%204\">foo</a>"));
  }

  @Override
  protected boolean runPipeline(Jobs jobs) throws Exception {
    return new ResolveUriStage(HtmlSchema.getDefault(mq)).apply(jobs);
  }
}
