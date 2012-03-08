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
 * @fileoverview This test attempts to run some guest code as a cajoled module,
 * where the embedded Caja version number in the cajoled module does not match
 * the version of the JavaScript files. It asserts that this situation fails
 * safe and logs an appropriate error.
 *
 * @author ihab.awad@gmail.com
 * @requires caja, jsunitRun, readyToTest
 */

registerTest('testVersionSkew', function testVersionSkew() {
  fetch('es53-test-guest.out.html', function(resp) {
    var htmlAndScript = splitHtmlAndScript(resp);
    var html = htmlAndScript[0];
    var script = htmlAndScript[1].replace(
        new RegExp(cajaBuildVersion, 'g'),
        '0000');
    var div = createDiv();
    caja.initialize({
      cajaServer: '/caja',
      debug: true
    });
    caja.load(div, undefined, function (frame) {
      caja.iframe.contentWindow.console = console;
      frame.iframe.contentWindow.console = console;
      clientSideLoaded = true;
      try {
        frame.cajoled('/', script, html)
             .run(function(result) {
               // If we succeed in running, we fail the test!
               fail('testVersionSkew');
               clearInterval(checkErrorsInterval);
             });
      } catch (e) {
        if (/Version error/.test(e)) {
          jsunitPass('testVersionSkew');
        }
      }
    });
  });
});

// Start the actual testing.

readyToTest();
jsunitRun();
