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

function fetch(url, callback) {
  var xhr = bridalMaker(function (x){return x;}, document).makeXhr();
  xhr.open('GET', url, true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4 && xhr.status === 200) {
      callback(xhr.responseText);
    }
  };
  xhr.send(null);
}

function initFrame(div, frameCallback) {
  caja.initialize({
    cajaServer: '/caja',
    debug: true,
    forceES5Mode: inES5Mode
  });
  caja.load(
      document.getElementById('untrusted_content'),
      {
        rewrite: function (uri, uriEffect, loaderType, hints) {
          // special case for testScriptLoading
          var m = uri.getPath().match(
              /^([^?#]*\/)?unproxied_whitelisted_script\.js$/);
          if (m) { return (m[1] || '') + 'whitelisted_script.js'; }
          
          return '[[' + uri + ']]';
        }
      },
      function(frame) { frameCallback(caja, frame); });
}

var idPattern = /^.*\-IDSUFFIX$/;

function rewriteIdSuffixes(node, idSuffix) {
  if (node.getAttribute) {
    var id = node.getAttribute('id');
    if (id && idPattern.test(id)) {
      node.setAttribute('id', id.replace('IDSUFFIX', idSuffix));
    }
  }
  for (var n = node.firstChild; n; n = n.nextSibling) {
    rewriteIdSuffixes(n, idSuffix);
  }
}

// globalSideEffect() is not exposed to cajoled code, so if cajoled code
// can reach it, then it has escaped containment.
// checkGlobalSideEffect() is exposed to cajoled code and returns true iff
// globalSideEffect() has been called since the last call to
// checkGlobalSideEffect().
(function () {
  var sideEffectHappened = false;
  function globalSideEffect(detail) { sideEffectHappened = detail || true; }
  function checkGlobalSideEffect() {
    var result = sideEffectHappened;
    sideEffectHappened = false;
    return result;
  }
  this.globalSideEffect = globalSideEffect;
  this.checkGlobalSideEffect = checkGlobalSideEffect;
})();

// Test that side effect catching works by trying it uncajoled.
jsunitRegister(
    '_testSideEffectTestFramework',
    function _testSideEffectTestFramework() {
      assertFalse(checkGlobalSideEffect());
      var s = document.createElement('SCRIPT');
      s.text = 'globalSideEffect()';
      document.body.appendChild(s);
      assertTrue(checkGlobalSideEffect());
      assertFalse(checkGlobalSideEffect());
      jsunit.pass('_testSideEffectTestFramework');
    });

var testDiv = document.createElement('div');
document.body.appendChild(testDiv);

// modified by whitelisted_script.js
var externalScript = { loaded: false };

fetch('es53-test-domado-special-initial-state.html', function(initialHtml) {
  testDiv.innerHTML = initialHtml;
  var virtualDoc = document.getElementById('untrusted_content');

  // Extra little dance because we want to have initial content *and* guest
  // content, which is not a supported case. Extract initial-state content,
  // then reinsert later.
  var content = document.createDocumentFragment();
  while (virtualDoc.firstChild) {
    content.appendChild(virtualDoc.firstChild);
  }

  initFrame(virtualDoc, function(frameGroup, frame) {
    rewriteIdSuffixes(content, frame.idSuffix);
    var extraImports = createExtraImportsForTesting(frameGroup, frame);

    extraImports.checkGlobalSideEffect =
      frame.tame(frame.markFunction(checkGlobalSideEffect));
      
    frame.grantRead(externalScript, 'loaded');
    extraImports.externalScript = frame.tame(externalScript);

    if (frameGroup.testing_makeDomadoRuleBreaker) {
      var rulebreaker = frameGroup.testing_makeDomadoRuleBreaker();
      extraImports.rulebreakerBreachSimulation = rulebreaker;
    }

    frame.code('es53-test-domado-special-guest.html')
         .api(extraImports)
         .run(function(result) {
               // reinsert special content
               var body = document.getElementsByTagName('caja-v-body')[0];
               body.insertBefore(content, body.firstChild);

               readyToTest();
               jsunitRun(null, null, asyncRequirements.evaluate);
             });
     });
  });



