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

// Called from css-stylesheet-tests.js in a JSONP style.
function runCssSelectorTests(testGroups) {
  function testCssStylesheets() {
    for (var j = 0, m = testGroups.length; j < m; ++j) {
      var testGroup = testGroups[j];
      var name = testGroup.test_name;
      assertEquals('testGroups[' + j + '].name', 'string', typeof name);
      var tests = testGroup.tests;
      for (var i = 0, n = tests.length; i < n; ++i) {
        var test = tests[i];
        var input = test.cssText;
        var golden = test.golden;
        assertEquals(
            name + ' tests[' + i + '].cssText', 'string', typeof input);
        assertEquals(
            name + ' tests[' + i + '].golden', 'string', typeof golden);

        var actual = sanitizeStylesheet(test.cssText);
        // The Java version produces property groups without a trailing
        // ';' since the semicolon is technically a separator in CSS.
        // This JavaScript version does not because it is simpler to
        // just treat it as a terminator.
        actual = actual.replace(/;\}/g, '}');
        if (golden !== actual && 'string' === typeof test.altGolden) {
          golden = test.altGolden;
        }
        assertEquals('stylesheet test ' + i + ': ' + input, golden, actual);
      }
    }
  }
  // Create a test method that will be called by jsUnit.
  jsunitRegister('testCssStylesheets', testCssStylesheets);
}
