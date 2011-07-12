// Copyright (C) 2010 Google Inc.
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
 * Scripts for browser_test_case.html.
 *
 * This page sets up a complete testing environment using ES53, and provides
 * quick and easy access to jsUnit test functions. For programmatic testing,
 * it is invoked by Java class BrowserTestCase.
 *
 *
 * ***** URL PARAMETERS *****
 *
 * This page is invoked with one or the other of the following parameters:
 *
 *   ?test-driver=<javascripturl>
 *
 *       Loads the script at <javascripturl> into the top level JavaScript
 *       context of this page as a test driver. This script is run un-cajoled;
 *       it may set up some further testing environment then use the functions
 *       provided by this page to load cajoled code and performs tests.
 *
 *   ?test-case=<htmlurl>
 *
 *       Invokes a default test driver that cajoles and loads the HTML file
 *       at <htmlurl> in a sandbox where jsUnit functions and other utilities
 *       are provided by default (see description of standard imports below).
 *       The HTML file is expected to register and run tests.
 *
 * In case both parameters are provided, "test-driver" is given priority.
 *
 *
 * ***** TOP LEVEL VARIABLES PROVIDED *****
 *
 * This script defines the following symbols at the top level that can be
 * used (or, in some cases, overridden) by test drivers.
 *
 *   getUrlParam(name)
 *
 *      Given the name of a URL parameter, obtain its value as specified in
 *      the URL used to invoke this document, or the empty string if the
 *      parameter is not specified.
 *
 *   readyToTest()
 *
 *       Must be called by the test driver when all test setup is complete.
 *       This is essential when the test is being invoked programmatically
 *       by Java class BrowserTestCase.
 *
 *   createDiv()
 *
 *       Simple utility to create and <DIV>, append it to the document body
 *       and return it.
 *
 *   createExtraImportsForTesting(frameGroup, frame)
 *
 *       Given an ES5 frame object, returns a set of standard imports that can
 *       be provided to cajoled code, tamed for use by the cajoled code. The
 *       standard imports are described below.
 *
 *   caja
 *
 *       At the time the test driver is running, an instance of the "caja"
 *       object, as defined in "c/g/c/caja.js", will be available.
 *
 *   setUp(), tearDown()
 *
 *       Functions expected by jsUnit that the test driver may override.
 *
 *   eeterter, jsunitRun, assertTrue(), assertEquals(), ...
 *
 *       All jsUnit objects and functions are available at the top level.
 *
 *
 * ***** CONTENTS OF THE STANDARD IMPORTS *****
 *
 *   console
 *
 *       A console object.
 *
 *   jsunitRegister, jsunitRun, assertTrue(), assertEquals(), ...
 *
 *       Tamed versions of all jsUnit objects and functions are provided.
 *
 *  [ TODO(ihab.awad): Document more as we determine they are useful. ]
 *
 */
function setUp() { }
function tearDown() { }

// URL parameter parsing code from blog at:
// http://www.netlobo.com/url_query_string_javascript.html
function getUrlParam(name) {
  name = name.replace(/[\[]/,"\\\[").replace(/[\]]/,"\\\]");
  var regexS = "[\\?&]"+name+"=([^&#]*)";
  var regex = new RegExp(regexS);
  var results = regex.exec(window.location.href);
  return (results == null) ? "" : results[1];
}

function pageLoaded___() {
  var scriptTag = document.createElement('script');
  scriptTag.setAttribute('src',
      getUrlParam('test-driver')
      || 'default-test-driver.js');
  document.body.appendChild(scriptTag);
}

function readyToTest() {
  document.getElementById('automatedTestingReadyIndicator')
      .className = 'readytotest';
}

function registerTest(name, f) {
  var e = document.createElement('div');
  e.innerHTML = 'Test ' + name;
  e.setAttribute('id', name);
  e.setAttribute('class', 'testcontainer waiting');
  document.body.appendChild(e);
  jsunitRegister(name, f);
}

/**
 * Canonicalize innerHTML output:
 *   - collapse all whitespace to a single space
 *   - remove whitespace between adjacent tags
 *   - lowercase tagnames and attribute names
 *   - sort attributes by name
 *   - quote attribute values
 *
 * Without this step, it's impossible to compare innerHTML cross-browser.
 */
function canonInnerHtml(s) {
  // Sort attributes.
  var htmlAttribute = new RegExp(
      '\\s*(\\w+)(?:\\s*=\\s*("[^\\"]*"|\'[^\\\']*\'|[^\\\'\\"\\s>]+))?');
  var quot = new RegExp('"', 'g');
  var tagBody = '(?:"[^"]*"|\'[^\']*\'|[^>"\']+)*';
  var htmlStartTag = new RegExp('(<\\w+)(' + tagBody + ')>', 'g');
  var htmlTag = new RegExp('(<\/?)(\\w+)(' + tagBody + ')>', 'g');
  var ignorableWhitespace = new RegExp('^[ \\t]*(\\r\\n?|\\n)|\\s+$', 'g');
  var tagEntityOrText = new RegExp(
      '(?:(</?\\w[^>]*>|&[a-zA-Z#]|[^<&>]+)|([<&>]))', 'g');
  s = s.replace(
      htmlStartTag,
      function (_, tagStart, tagBody) {
        var attrs = [];
        for (var m; tagBody && (m = tagBody.match(htmlAttribute));) {
          var name = m[1].toLowerCase();
          var value = m[2];
          var hasValue = value != null;
          if (hasValue && (new RegExp('^["\']')).test(value)) {
            value = value.substring(1, value.length - 1);
          }
          attrs.push(
              hasValue
              ? name + '="' + value.replace(quot, '&quot;') + '"'
              : name);
          tagBody = tagBody.substring(m[0].length);
        }
        attrs.sort();
        attrs.unshift(tagStart);
        return attrs.join(' ') + '>';
      });
  s = s.replace(
      htmlTag,
      function (_, open, name, body) {
        return open + name.toLowerCase() + (body || '') + '>';
      });
  // Collapse whitespace.
  s = s.replace(new RegExp('\\s+', 'g'), ' ');
  s = s.replace(new RegExp('^ | $', 'g'), '');
  s = s.replace(new RegExp('[>]\\s+[<]', 'g'), '><');
  // Normalize escaping of text nodes since Safari doesn't escape loose >.
  s = s.replace(
      tagEntityOrText,
      function (_, good, bad) {
        return good
            ? good
            : (bad.replace(new RegExp('&', 'g'), '&amp;')
               .replace(new RegExp('>', 'g'), '&gt;'));
      });
  return s;
}

function assertStringContains(chunk, text) {
  if (text.indexOf(chunk) !== -1) { return; }
  fail('Cannot find <<' + chunk + '>> in <<' + text + '>>');
}

function createDiv() {
  var d = document.createElement('div');
  document.body.appendChild(d);
  return d;
}

// TODO: async requirements are not counted in the test status.

// Define an asynchronous test mechanism so that we can test things like
// XHR, dynamic script loading, setTimeout, etc.
// This allows test code to register conditions that must be true.
// The conditions can be run periodically until all are satisfied or
// the test times out.
// If a condition returns true once, it is never evaluated again.
// TODO(mikesamuel): rewrite XHR and setTimeout tests to use this scheme.
var asyncRequirements = (function () {
  var req = [];
  var intervalId = null;
  var TIMEOUT_MILLIS = 250;

  /**
   * Registers a requirement for later checking.
   * @param {string} msg descriptive text used in error messages.
   * @param {function () : boolean} predicate returns true to indicate
   *     the requirement has been satisfied.
   */
  var assert = function (msg, predicate) {
    req.push({ message: String(msg), predicate: predicate });
  };

  /**
   * Start checking the asynchronous requirements.
   * @param {function (boolean) : void} handler called with the value
   *     {@code true} when and if all requirements are satisfied.
   *     Called with false if more than TIMEOUT_MILLIS time passes
   *     and requirements still aren't satisfied.
   */
  var evaluate = function (handler) {
    if (!handler) {
      handler = function (pass) {
        if (!pass) {
          document.title = document.title.replace(
              /all tests passed/, 'async tests failed');
        }
      };
    }
    if (intervalId !== null) { throw new Error('dupe handler'); }
    if (req.length === 0) {
      handler(true);
    } else {
      var timeoutTime = (new Date).getTime() + TIMEOUT_MILLIS;
      intervalId = setInterval(function () {
        for (var i = req.length; --i >= 0;) {
          var msgAndPredicate = req[i];
          try {
            if (true === msgAndPredicate.predicate()) {
              // Requirement satisfied.
              req[i] = req[req.length - 1];
              --req.length;
            }
          } catch (e) {
            console.error(
                'Asynchronous failure : ' + msgAndPredicate.message);
          }
        }
        if (req.length === 0 || (new Date).getTime() >= timeoutTime) {
          clearInterval(intervalId);
          intervalId = null;

          var failures = req.length !== 0;
          if (failures) {
            for (var i = req.length; --i >= 0;) {
              console.error('async test timeout: ' + req[i].message);
            }
            req.length = 0;
          }

          handler(!failures);
        }
      }, 50);
    }
  };

  return {
    assert: assert,
    evaluate: evaluate
  };
})();

function createExtraImportsForTesting(frameGroup, frame) {
  var standardImports = {};

  standardImports.readyToTest =
      frameGroup.tame(frameGroup.markFunction(readyToTest));
  standardImports.jsunitRun =
      frameGroup.tame(frameGroup.markFunction(jsunitRun));
  standardImports.jsunitRegister =
      frameGroup.tame(frameGroup.markFunction(jsunitRegister));
  standardImports.jsunitPass =
      frameGroup.tame(frameGroup.markFunction(jsunitPass));
  standardImports.jsunitCallback =
      frameGroup.tame(frameGroup.markFunction(function(cb, opt_id) {
        return jsunitCallback(cb, opt_id, frameGroup);
      }));
  standardImports.canonInnerHtml =
      frameGroup.tame(frameGroup.markFunction(canonInnerHtml));
  standardImports.assertStringContains =
      frameGroup.tame(frameGroup.markFunction(assertStringContains));

  // Create a readonly mirror of document so that we can test that mutations
  // fail when they should.
  standardImports.documentRO =
    new frame.imports.TameHTMLDocument___(
        document,          // Document of host frame
        frame.div,         // Containing div in host frame
        'nosuchhost.fake', // Fake domain name
        false);            // Not writeable

  var fakeConsole = {
    log: frameGroup.markFunction(function () {
      console.log.apply(console, arguments);
    }),
    warn: frameGroup.markFunction(function () {
      console.warn.apply(console, arguments);
    }),
    error: frameGroup.markFunction(function () {
      console.error.apply(console, arguments);
    }),
    trace: frameGroup.markFunction(function () {
      console.trace ? console.trace()
          : console.error.apply(console, arguments);
    })
  };

  standardImports.console = frameGroup.tame(fakeConsole);

  standardImports.$ = frameGroup.tame(frameGroup.markFunction(function(id) {
    return frame.imports.document.getElementById(id);
  }));

  var ___ = frameGroup.iframe.contentWindow.___;

  // Give unfiltered DOM access so we can check the results of actions.
  var directAccess = {
    // Allow testing of emitHtml by exposing it for testing
    click: function (tameNode) {
      tameNode.node___.click();
    },
    emitCssHook: function (css) {
      frame.imports.emitCss___(css.join(frame.idSuffix));
    },
    getInnerHTML: function (tameNode) {
      return tameNode.node___.innerHTML;
    },
    getAttribute: function (tameNode, name) {
      return tameNode.node___.getAttribute(name);
    },
    getBodyNode: function () {
      return frame.imports.tameNode___(frame.innerContainer);
    },
    getComputedStyle: function (tameNode, styleProp) {
      var node = tameNode.node___;
      if (node.currentStyle) {
        return node.currentStyle[styleProp.replace(
            /-([a-z])/g,
            function (_, letter) {
              return letter.toUpperCase();
            })];
      } else if (window.getComputedStyle) {
        return window.getComputedStyle(node, null)
            .getPropertyValue(styleProp);
      } else {
        return null;
      }
    },
    // Lets tests check that an outer hull breach -- access to
    // an unexecuted script node -- does not allow a full breach.
    makeUnattachedScriptNode: function () {
      var s = document.createElement('script');
      s.appendChild(document.createTextNode('/* intentionally blank */'));
      return frame.imports.tameNode___(s, true);
    },
    getIdSuffix: function() {
      return frame.idSuffix;
    }
  };

  function makeCallable(f) { f.f___ = f; }

  makeCallable(directAccess.click);
  makeCallable(directAccess.emitCssHook);
  makeCallable(directAccess.getInnerHTML);
  makeCallable(directAccess.getAttribute);
  makeCallable(directAccess.getBodyNode);
  makeCallable(directAccess.getComputedStyle);
  makeCallable(directAccess.makeUnattachedScriptNode);

  standardImports.directAccess = {
    v___: function(p) { return directAccess[p]; },
    m___: function(p, as) { return directAccess[p].apply({}, as); }
  };

  // Marks a container green to indicate that test passed
  standardImports.pass = frameGroup.tame(frameGroup.markFunction(function (id) {
    jsunit.pass(id);
    var node = frame.imports.document.getElementById(id);
    if (!node) return;
    node = node.node___;
    node.appendChild(document.createTextNode('Passed ' + id));
    var cl = node.className || '';
    cl = cl.replace(/\b(clickme|waiting)\b\s*/g, '');
    cl += ' passed';
    node.className = cl;
  }));

  standardImports.expectFailure =
      frameGroup.tame(frameGroup.markFunction(expectFailure));
  standardImports.assertFailsSafe =
      frameGroup.tame(frameGroup.markFunction(assertFailsSafe));

  standardImports.assertColor = frameGroup.tame(frameGroup.markFunction(
      function(expected, cssColorString) {
        if (typeof cssColorString === 'string') {
          cssColorString = cssColorString.toLowerCase();
        }
        if (cssColorString === expected.name) { return; }
        if (cssColorString === '"' + expected.name + '"') { return; }
        var hexSix = expected.rgb.toString(16);
        while (hexSix.length < 6) { hexSix = '0' + hexSix; }
        if (cssColorString === '#' + hexSix) { return; }
        var hexThree = hexSix.charAt(0) + hexSix.charAt(2) + hexSix.charAt(4);
        if (cssColorString === '#' + hexThree) { return; }

        var stripped = cssColorString.replace(new RegExp(' ', 'g'), '');
        if (('rgb(' + (expected.rgb >> 16)
             + ',' + ((expected.rgb >> 8) & 0xff)
             + ',' + (expected.rgb & 0xff) + ')') === stripped) {
          return;
        }

        fail(cssColorString + ' != #' + hexSix);
      }));

  standardImports.assertAsynchronousRequirement =
      frameGroup.tame(frameGroup.markFunction(asyncRequirements.assert));

  var jsunitFns = [
      'assert', 'assertContains', 'assertEquals', 'assertEvaluatesToFalse',
      'assertEvaluatesToTrue', 'assertFalse', 'assertHTMLEquals',
      'assertHashEquals', 'assertNotEquals', 'assertNotNull',
      'assertNotUndefined', 'assertNull', 'assertRoughlyEquals',
      'assertThrows', 'assertTrue', 'assertObjectEquals', 'assertUndefined',
      'error', 'fail', 'setUp', 'tearDown'];
  for (var i = jsunitFns.length; --i >= 0;) {
    var name = jsunitFns[i];
    if (standardImports.hasOwnProperty(name)) {
      throw new Error('already defined', name);
    }
    standardImports[name] =
        frameGroup.tame(frameGroup.markFunction(window[name]));
  }

  return standardImports;
}
