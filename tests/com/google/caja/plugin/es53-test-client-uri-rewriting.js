// Copyright (C) 2011 Google Inc.
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

/**
 * @fileoverview Makes sure that the client-side rewriting of URIs embedded
 * in guest HTML/CSS input works properly.
 *
 * @author ihab.awad@gmail.com
 * @requires caja, jsunitRun, readyToTest
 */

(function () {

  var uriCallback = {
    rewrite: function (uri) {
      return 'URICALLBACK[[' + uri + ']]';
    }
  };

  caja.initialize({
    cajaServer: 'http://localhost:8000/caja',
    debug: true
  });
  

  registerTest('testUriInAttr', function testUriInAttr() {
    var div = createDiv();
    caja.load(div, uriCallback, function (frame) {
      frame.code('es53-test-client-uri-rewriting-guest.html')
          .run(function (_) {
        assertStringContains(
          canonInnerHtml(
              '<a href="URICALLBACK[['
              + 'http://localhost:8000/ant-lib/'
              + 'com/google/caja/plugin/bar.html'
              + ']]" target="_blank">bar</a>'),
          canonInnerHtml(div.innerHTML));
        jsunitPass('testUriInAttr');
      });
    });
  });

  registerTest('testUriInCss', function testUriInCss() {
    var div = createDiv();
    caja.load(div, uriCallback, function (frame) {
      var emittedCss;
      var originalEmitCss = frame.imports.emitCss___;
      frame.imports.emitCss___ = function(cssText) {
        if (emittedCss) { throw 'cannot handle multiple emitCss___'; }
         emittedCss = cssText;
         originalEmitCss.call(this, cssText);
      };

      frame.code('es53-test-client-uri-rewriting-guest.html')
          .run(function (_) {
        assertStringContains(
          'url(URICALLBACK[['
          + 'http://localhost:8000/ant-lib/com/google/caja/plugin/foo.png'
          + ']])',
          emittedCss);
        jsunitPass('testUriInCss');
      });
    });
  });
    
  readyToTest();
  jsunitRun();
})();
