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

package com.google.caja.plugin;

public class Es5BrowserTest extends UniversalBrowserTests {
  public Es5BrowserTest() {
    super(true /* es5Mode */);
  }

  public void testCajaJsBare() throws Exception {
    runBrowserTest("cajajs-bare-test.html", "es5=true");
  }

  public void testExternalScript() throws Exception {
    runTestCase("es53-test-external-script-guest.html", true);
  }

  public void testUnicode() throws Exception {
    runTestDriver("es53-test-unicode.js", es5Mode);
  }

  public void testCssImports() throws Exception {
    runTestCase("es53-test-css-imports-guest.html", true);
  }
}
