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
 *   inES5Mode
 *
 *       Boolean whether we are running in pure ES5 or ES5/3 translation mode.
 *
 *   minifiedMode
 *
 *       Boolean whether we want to load minified files.
 *
 *   caja
 *
 *       At the time the test driver is running, an instance of the "caja"
 *       object, as defined in "c/g/c/caja.js", will be available.
 *
 *   basicCajaConfig
 *
 *       An appropriate set of parameters to caja.initialize or
 *       caja.makeFrameGroup.
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
 * TODO(kpreid): Clean up stuff not intended to be exported.
 * @requires document, setInterval, setTimeout, clearInterval, Proxy, console,
 *     jsunit, jsunitRegisterAuxiliaryStatus, jsunitRun, jsunitRegister,
 *     jsunitRegisterIf, jsunitCallback, jsunitPass, jsunitFail, expectFailure,
 *     JsUnitException, assertFailsSafe, fail,
 *     bridalMaker
 * @provides cajaBuildVersion, getUrlParam, withUrlParam, readyToTest,
 *     createDiv, createExtraImportsForTesting, inES5Mode, minifiedMode,
*      basicCajaConfig
 *     setUp, tearDown,
 *     asyncRequirements,
 *     canonInnerHtml, assertStringContains, assertStringDoesNotContain,
 *     splitHtmlAndScript, pageLoaded___, urlParamPattern, fetch
 * @overrides window
 */
function setUp() { }
function tearDown() { }

// Current SVN version interpolated below by "build.xml"
var cajaBuildVersion = '%VERSION%';

// URL parameter parsing code from blog at:
// http://www.netlobo.com/url_query_string_javascript.html
function urlParamPattern(name) {
  name = name.replace(/[\[]/,"\\[").replace(/[\]]/,"\\]");
  return new RegExp("([\\?&]"+name+"=)([^&#]*)");
}
function getUrlParam(name, opt_default) {
  var match = urlParamPattern(name).exec(window.location.href);
  if (match) {
    return decodeURIComponent(match[2].replace(/\+/g, ' '));
  } else {
    return opt_default ? opt_default : '';
  }
}

/**
 * Construct the page URL with the specified parameter added/replaced.
 */
function withUrlParam(name, value) {
  var pat = urlParamPattern(name);
  var current = window.location.href;
  if (!pat.test(current)) {
    return current + '&' + encodeURIComponent(name) + '=' +
        encodeURIComponent(value);
  } else {
    return current.replace(pat,
        function(match, prefix) {
          return prefix + encodeURIComponent(value);
        });
  }
}

function pageLoaded___() {
  var scriptTag = document.createElement('script');
  scriptTag.setAttribute('src',
      getUrlParam('test-driver')
      || 'default-test-driver.js');
  var where = document.getElementsByTagName('script')[0];
  where.parentNode.insertBefore(scriptTag, where);
}

function readyToTest() {
  document.getElementById('automatedTestingReadyIndicator')
      .className = 'readytotest';
}

var inES5Mode;
if (getUrlParam('es5') === 'true') {
  inES5Mode = true;
} else if (getUrlParam('es5') === 'false') {
  inES5Mode = false;
} else {
  throw new Error('es5 parameter is not "true" or "false"');
}

var minifiedMode;
if (getUrlParam('minified', 'true') === 'true') {
  minifiedMode = true;
} else if (getUrlParam('minified', 'true') === 'false') {
  minifiedMode = false;
} else {
  throw new Error('minified parameter is not "true" or "false"');
}

var basicCajaConfig = {
  cajaServer: '/caja',
  debug: !minifiedMode,
  forceES5Mode: inES5Mode
};

// Construct test case navigation toolbar
window.addEventListener('load', function() {
  var toolbar = document.getElementById('toolbar');
  var put = toolbar.appendChild.bind(toolbar);

  function link(label, state, href, opt_title) {
    var el;
    if (state) {
      el = document.createElement('strong');
    } else {
      el = document.createElement('a');
      el.href = href;
    }
    el.textContent = label;
    el.title = opt_title !== undefined ? opt_title : '';
    return el;
  }
  function widget() {
    var el = document.createElement('span');
    el.className = 'widget';
    for (var i = 0; i < arguments.length; i++) {
      if (i !== 0) { el.appendChild(document.createTextNode('\u00a0\u00a0')); }
      el.appendChild(arguments[i]);
    }
    return el;
  }

  put(widget(
      link('ES5/3', !inES5Mode, withUrlParam('es5', 'false')),
      link('SES', inES5Mode, withUrlParam('es5', 'true'))));

  var max = getUrlParam('minified') === 'false';
  put(widget(
      link('source', max, withUrlParam('minified', 'false')),
      link('minified', !max, withUrlParam('minified', 'true'))));

  function doModule(testModuleParam) {
    var testModulePath = getUrlParam(testModuleParam);
    if (testModulePath === '') { return; }
    var sourceMatch = (/^\/tests\/com\/google\/caja\/plugin\/(.*)$/
        .exec(testModulePath));
    var testModuleBare = sourceMatch ? sourceMatch[1] : testModulePath;
    var sl;
    put(widget(
        link('built', !sourceMatch, withUrlParam(testModuleParam,
            testModuleBare)),
        link('from source tree', sourceMatch, withUrlParam(testModuleParam,
                '/tests/com/google/caja/plugin/' + testModuleBare),
            'does not work for all tests')));

    put(document.createTextNode(testModuleParam + ': '));
    put(link(testModuleBare, false, testModulePath,
        'to verify text / force reload'));
  }
  doModule('test-driver');
  doModule('test-case');
}, false);

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
      '\\s*([\\w-]+)(?:\\s*=\\s*("[^\\"]*"|\'[^\\\']*\'|[^\\\'\\"\\s>]+))?');
  var quot = new RegExp('"', 'g');
  var tagBody = '(?:"[^"]*"|\'[^\']*\'|[^>"\']+)*';
  var htmlStartTag = new RegExp('(<[\\w-]+)(' + tagBody + ')>', 'g');
  var htmlTag = new RegExp('(<\/?)([\\w-]+)(' + tagBody + ')>', 'g');
  var ignorableWhitespace = new RegExp('^[ \\t]*(\\r\\n?|\\n)|\\s+$', 'g');
  var tagEntityOrText = new RegExp(
      '(?:(</?[\\w-][^>]*>|&[a-zA-Z#]|[^<&>]+)|([<&>]))', 'g');
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
  if (typeof text !== 'string') {  // protect indexOf call
    fail('Expected a string, got the ' + typeof text + ': ' + text);
  }
  if (text.indexOf(chunk) !== -1) { return; }
  fail('Cannot find <<' + chunk + '>> in <<' + text + '>>');
}

function assertStringDoesNotContain(chunk, text) {
  if (typeof text !== 'string') {  // protect indexOf call
    fail('Expected a string, got the ' + typeof text + ': ' + text);
  }
  if (text.indexOf(chunk) === -1) { return; }
  fail('Unexpectedly found <<' + chunk + '>> in <<' + text + '>>');
}

function createDiv() {
  var d = document.createElement('div');
  document.body.appendChild(d);
  return d;
}

// Define an asynchronous test mechanism so that we can test things like
// XHR, dynamic script loading, setTimeout, etc.
// This allows test code to register conditions that must be true.
// The conditions can be run periodically until all are satisfied or
// the test times out.
// If a condition returns true once, it is never evaluated again.
// TODO(mikesamuel): rewrite XHR and setTimeout tests to use this scheme.
// TODO(kpreid): Integrate this fully into jsunit.js.
var asyncRequirements = (function () {
  var req = [];
  var intervalId = null;
  var TIMEOUT_MILLIS = 250;

  /**
   * Registers a requirement for later checking.
   * @param {string} msg descriptive text used in error messages.
   * @param {function () : boolean} predicate returns true to indicate
   *     the requirement has been satisfied.
   * @param {function} opt_continuation called after the predicate returns
   *     true, as part of a jsunit test.
   */
  var assert = function (msg, predicate, opt_continuation) {
    // TODO(kpreid): nicer shorter id
    var id = jsunit.getCurrentTestId() + '_' + msg;

    // Register a stub test which will be passed by the async evaluator.
    jsunitRegisterAuxiliaryStatus(id);

    req.push({
      message: String(msg),
      predicate: predicate,
      id: id,
      continuation: opt_continuation || function() {}
    });
  };

  /**
   * Start checking the asynchronous requirements.
   * @param {function (boolean) : void} handler called with the value
   *     {@code true} when and if all requirements are satisfied.
   *     Called with false if more than TIMEOUT_MILLIS time and (number
   *     of registered tests * 2) turns pass and requirements still
   *     aren't satisfied.
   */
  var evaluate = function (handler) {
    if (!handler) {
      handler = function() {};
    }
    if (intervalId !== null) { throw new Error('dupe handler'); }
    if (req.length === 0) {
      handler(true);
    } else {
      var asyncStartTime = (new Date).getTime();
      var timeoutTime = asyncStartTime + TIMEOUT_MILLIS;
      var timeoutTurns = jsunit.testCount * 2;
      var turn = 0;
      intervalId = setInterval(function () {
        turn++;
        for (var i = req.length; --i >= 0;) {
          var record = req[i];
          try {
            if (true === record.predicate()) {
              // Requirement satisfied.
              req[i] = req[req.length - 1];
              --req.length;
              (function(record) {
                setTimeout(jsunitCallback(function() {
                  record.continuation();
                  jsunitPass(record.id);
                }, record.id), 0);
              })(record);
            }
          } catch (e) {
            // TODO(kpreid): convert this to failure of the registered test
            console.error(
                'Asynchronous failure : ' + record.message, e);
            req[i] = req[req.length - 1];
            --req.length;
          }
        }
        var now = (new Date).getTime();
        if (req.length === 0 || now >= timeoutTime && turn > timeoutTurns) {
          clearInterval(intervalId);
          intervalId = null;

          var timeoutDesc = 'async test timeout after ' + (now - asyncStartTime)
              + '/' + (timeoutTime - asyncStartTime) + ' ms and ' + turn + '/' +
              timeoutTurns + ' turns: ';

          var failures = req.length !== 0;
          if (failures) {
            for (var i = req.length; --i >= 0;) {
              var record = req[i];
              (function(record) {
                setTimeout(jsunitCallback(function() {
                  throw new Error(timeoutDesc + record.message);
                }, record.id), 0);
              })(record);
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

function fetch(url, cb) {
  var xhr = bridalMaker(function (x){return x;}, document).makeXhr();
  xhr.open('GET', url, true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        cb(xhr.responseText);
      } else {
        throw new Error('Failed to load ' + url + ' : ' + xhr.status);
      }
    }
  };
  xhr.send(null);
}

function splitHtmlAndScript(combinedHtml) {
  return combinedHtml.match(
    /^([\s\S]*?)<script[^>]*>([\s\S]*?)<\/script>\s*$/)
    .slice(1);
}

function createExtraImportsForTesting(frameGroup, frame) {
  var standardImports = {};

  standardImports.readyToTest =
      frame.tame(frame.markFunction(readyToTest));
  standardImports.jsunitRun =
      frame.tame(frame.markFunction(jsunitRun));
  standardImports.jsunitRegister =
      frame.tame(frame.markFunction(function(name, test) {
        jsunitRegister(name, test, frame.idClass);
      }));
  standardImports.jsunitRegisterIf =
      frame.tame(frame.markFunction(function(okay, name, test) {
        jsunitRegisterIf(okay, name, test, frame.idClass);
      }));
  // TODO(kpreid): With the new idClass wiring, pass and jsunitPass are the same
  // thing, so we shouldn't have two names.
  standardImports.pass =
      standardImports.jsunitPass =
      frame.tame(frame.markFunction(jsunitPass));
  standardImports.jsunitFail =
      frame.tame(frame.markFunction(jsunitFail));
  standardImports.jsunitCallback =
      frame.tame(frame.markFunction(function(cb, opt_id) {
        return jsunitCallback(cb, opt_id, frame);
      }));
  frame.markCtor(JsUnitException);
  frame.grantMethod(JsUnitException.prototype, 'toString');
  frame.grantRead(JsUnitException.prototype, 'isJsUnitException');
  frame.grantRead(JsUnitException.prototype, 'comment');
  frame.grantRead(JsUnitException.prototype, 'jsUnitMessage');
  standardImports.JsUnitException = frame.tame(JsUnitException);

  standardImports.canonInnerHtml =
      frame.tame(frame.markFunction(canonInnerHtml));
  standardImports.assertStringContains =
      frame.tame(frame.markFunction(assertStringContains));
  standardImports.assertStringDoesNotContain =
    frame.tame(frame.markFunction(assertStringDoesNotContain));

  if (frame.div) {
    // Create a node which is in a context such that it must be read-only.
    // (Note taming membrane is in use here, so we get/return feral nodes.)
    standardImports.makeReadOnly = frame.tame(frame.markFunction(
        function (node) {
      // Must clone to throw out the cached policy decision
      var clone = node.cloneNode(true);
      var container = document.createElement("anUnknownElement");
      container.appendChild(clone);
      node.parentNode.replaceChild(container, node);
      frame.domicile.tameNode(clone); // cause registration as Domado node
      return clone;
    }));
  }

  var fakeConsole = {
    // .prototype because Firebug console's methods have no apply method.
    log: frame.markFunction(function () {
      Function.prototype.apply.call(console.log, console, arguments);
    }),
    info: frame.markFunction(function () {
      Function.prototype.apply.call(console.info, console, arguments);
    }),
    warn: frame.markFunction(function () {
      Function.prototype.apply.call(console.warn, console, arguments);
    }),
    error: frame.markFunction(function () {
      Function.prototype.apply.call(console.error, console, arguments);
    }),
    trace: frame.markFunction(function () {
      console.trace ? console.trace()
          : Function.prototype.apply.call(console.error, console, arguments);
    })
  };

  standardImports.console = frame.tame(fakeConsole);

  standardImports.inES5Mode = inES5Mode;
  standardImports.proxiesAvailableToTamingCode = inES5Mode
      // In ES5, Domado runs in the taming frame's real global env
      ? typeof Proxy !== 'undefined'
      // ES5/3 provides proxies.
      : true;

  standardImports.getUrlParam = frame.tame(frame.markFunction(getUrlParam));
  standardImports.modifyUrlParam = frame.tame(frame.markFunction(
      function(name, value) {
    window.location = withUrlParam(name, value);
  }));

  var ___ = frame.iframe.contentWindow.___;

  // Give unfiltered DOM access so we can check the results of actions.
  var directAccess = {
    // Allow testing of emitHtml by exposing it for testing
    click: function (tameNode) {
      frame.domicile.feralNode(tameNode).click();
    },
    emitCssHook: function (css) {
      if (inES5Mode) {
        frame.domicile.emitCss(css.join(frame.idSuffix));
      } else {
        // same as above but tests more of the wiring for cajoled input
        frame.imports.emitCss___(css.join(frame.idSuffix));
      }
    },
    getInnerHTML: function (tameNode) {
      return frame.domicile.feralNode(tameNode).innerHTML;
    },
    getAttribute: function (tameNode, name) {
      return frame.domicile.feralNode(tameNode).getAttribute(name);
    },
    getFeralProperty: function(obj, prop) {
      // Unsafe in general, busts the membrane -- use only for === tests and
      // such.
      return frame.untame(obj)[prop];
    },
    getParentNode: function(tameNode) {
      // escapes foreign node/outside-of-vdoc protection
      return frame.domicile.tameNode(
          frame.domicile.feralNode(tameNode).parentNode);
    },
    getVdocNode: function () {
      return frame.domicile.tameNode(frame.innerContainer);
    },
    getComputedStyle: function (tameNode, styleProp, opt_pseudoElement) {
      var node = frame.untame(tameNode);
      if (node.currentStyle && !opt_pseudoElement) {
        return node.currentStyle[styleProp.replace(
            /-([a-z])/g,
            function (_, letter) {
              return letter.toUpperCase();
            })];
      } else if (window.getComputedStyle) {
        var cs = window.getComputedStyle(
            node,
            opt_pseudoElement || null);
        return cs.getPropertyValue(styleProp);
      } else {
        return null;
      }
    },
    // Lets tests check that an outer hull breach -- access to
    // an unexecuted script node -- does not allow a full breach.
    makeUnattachedScriptNode: function () {
      var s = document.createElement('script');
      s.appendChild(document.createTextNode('/* intentionally blank */'));
      return frame.domicile.tameNode(s, true);
    },
    getIdSuffix: function() {
      return frame.idSuffix;
    },
    // Test if a given feral object has a property
    feralFeatureTest: function(tame, jsProp) {
      return jsProp in frame.untame(tame);
    },
    evalInHostFrame: function(code) {
      return new Function('return (' + code + ');')();
    },
    evalInTamingFrame: function(code) {
      return frameGroup.iframe.contentWindow.eval(code);
    },
    scrollToEnd: function() {
      window.scrollTo(0, document.body.offsetHeight);
    }
  };

  function makeCallable(f) { f.f___ = f; }

  makeCallable(directAccess.click);
  makeCallable(directAccess.emitCssHook);
  makeCallable(directAccess.getInnerHTML);
  makeCallable(directAccess.getAttribute);
  makeCallable(directAccess.getParentNode);
  makeCallable(directAccess.getVdocNode);
  makeCallable(directAccess.getComputedStyle);
  makeCallable(directAccess.makeUnattachedScriptNode);
  makeCallable(directAccess.evalInHostFrame);
  makeCallable(directAccess.evalInTamingFrame);
  makeCallable(directAccess.scrollToEnd);

  if (!inES5Mode) {
    // TODO(kpreid): This wrapper could be replaced by the 'makeDOMAccessible'
    // tool defined in caja.js for use by Domado.
    standardImports.directAccess = {
      v___: function(p) { return directAccess[p]; },
      m___: function(p, as) { return directAccess[p].apply({}, as); }
    };
  } else {
    standardImports.directAccess = directAccess;
  }

  standardImports.expectFailure =
      frame.tame(frame.markFunction(expectFailure));
  standardImports.assertFailsSafe =
      frame.tame(frame.markFunction(assertFailsSafe));

  function matchColor(expected, cssColorString) {
    if (typeof cssColorString === 'string') {
      cssColorString = cssColorString.toLowerCase();
    }
    if (cssColorString === expected.name) { return true; }
    if (cssColorString === '"' + expected.name + '"') { return true; }
    var hexSix = expected.rgb.toString(16);
    while (hexSix.length < 6) { hexSix = '0' + hexSix; }
    if (cssColorString === '#' + hexSix) { return true; }
    var hexThree = hexSix.charAt(0) + hexSix.charAt(2) + hexSix.charAt(4);
    if (cssColorString === '#' + hexThree) { return true; }

    var stripped = cssColorString.replace(new RegExp(' ', 'g'), '');
    if (('rgb(' + (expected.rgb >> 16)
         + ',' + ((expected.rgb >> 8) & 0xff)
         + ',' + (expected.rgb & 0xff) + ')') === stripped) {
      return true;
    }

    return false;
  }
  standardImports.matchColor = frame.tame(frame.markFunction(matchColor));

  standardImports.assertColor = frame.tame(frame.markFunction(
      function(expected, cssColorString) {
        if (!matchColor(expected, cssColorString)) {
          fail(cssColorString + ' != #' + expected.rgb.toString(16));
        }
      }));

  standardImports.assertAsynchronousRequirement =
      frame.tame(frame.markFunction(asyncRequirements.assert));

  var jsunitFns = [
      'assert', 'assertContains', 'assertEquals', 'assertEvaluatesToFalse',
      'assertEvaluatesToTrue', 'assertFalse', 'assertHTMLEquals',
      'assertHashEquals', 'assertNaN', 'assertNotEquals', 'assertNotNull',
      'assertNotUndefined', 'assertNull', 'assertRoughlyEquals',
      'assertThrows', 'assertTrue', 'assertObjectEquals', 'assertUndefined',
      'assertThrowsMsg', 'error', 'fail', 'setUp', 'tearDown'];
  for (var i = jsunitFns.length; --i >= 0;) {
    var name = jsunitFns[i];
    if (standardImports.hasOwnProperty(name)) {
      throw new Error('already defined', name);
    }
    standardImports[name] =
        frame.tame(frame.markFunction(window[name]));
  }

  return standardImports;
}
