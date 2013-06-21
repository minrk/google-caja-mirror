// Copyright (C) 2013 Google Inc.
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
 * @fileoverview Tests using a mitigating url rewriter for SES.
 *
 * @author jasvir@gmail.com
 * @requires caja, jsunitRun, readyToTest, document, jsunitRegister,
 *     basicCajaConfig
 */

(function () {
  document.title += ' {closured=' + !caja.closureCanary + '}';

  var cachingUriPolicy = {
    fetch: caja.policy.net.fetcher.USE_XHR,
    rewrite: caja.policy.net.rewriter.ALL,
    mitigate: function (uri) {
      var before = '/es53-test-precajole.js';
      var prefix = '/ant-testlib/com/google/caja/plugin/';
      var after = prefix + 'es53-test-precajole-precajoled.js';
      return (uri.getPath() == before) ? after : null;
    }
  };

  caja.initialize(basicCajaConfig);

  jsunitRegister('testPrecajole', function testPrecajole() {
    caja.load(createDiv(), cachingUriPolicy, function (frame) {
      var extraImports = createExtraImportsForTesting(caja, frame);
      frame.code(
          location.protocol + '//' + location.host + '/',
          'text/html',
          '<div>' +
          '<script src="/es53-test-precajole.js">' +
          '</script>' +
          '</div>')
          .api(extraImports)
          .run();
    });
  });

  readyToTest();
  jsunitRun();

})();
