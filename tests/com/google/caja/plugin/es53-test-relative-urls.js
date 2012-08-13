// Copyright (C) 2012 Google Inc.
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
 * @fileoverview Tests how relative urls are resolved
 * @author jasvir@gmail.com
 * @requires caja, jsunitRun, readyToTest
 */
(function () {

  caja.initialize({
    cajaServer: '/caja',
    debug: true,
    forceES5Mode: inES5Mode
  });

  fetch('es53-test-relative-urls.html', function(testHtml) {
    registerTest('testRelativeUrls', function testRelativeUrls () {
      var div = createDiv();
      caja.load(div, caja.policy.net.ALL, function (frame) {
        frame.code('http://www.example.com/', 'text/html', testHtml)
          .api(createExtraImportsForTesting(caja, frame))
          .run(function() {
               readyToTest();
               jsunitRun();
               asyncRequirements.evaluate();
          });
      });
    });
  
    readyToTest();
    jsunitRun();
  });
})();
