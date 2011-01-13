// Copyright (C) 2010 Google Inc.
//      
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview ... TODO ihab.awad
 * @author kpreid@switchb.org
 * @author ihab.awad@gmail.com
 * @requires document, setTimeout, console
 * @provides caja
 */

var caja = (function () {
  function joinUrl(base, path) {
    while (base[base.length - 1] === '/') {
      base = base.slice(0, base.length - 1);
    }
    while (path[0] === '/') {
      path = path.slice(1, path.length);
    }
    return base + '/' + path;
  }

  function documentBaseUrl() {
    var bases = document.getElementsByTagName('base');
    if (bases.length == 0) {
      return document.location.toString();
    } else if (bases.length == 1) {
      var href = bases[0].href;
      if (typeof href !== 'string') {
        throw new Error('Caja loader error: <base> without a href.');
      }
      return href;
    } else {
      throw new Error('Caja loader error: document contains multiple <base>.');
    }
  }

  function createIframe() {
    // create iframe to load Cajita runtime in
    // TODO: Put a class on this so if the host page cares about 'all iframes'
    // it can filter this out?
    var frame = document.createElement("iframe");
    // hide it
    frame.style.display = "none";
    frame.width = 0;
    frame.height = 0;
    // stick it arbitrarily in the document
    document.body.appendChild(frame);
    return frame;
  }

  function installScript(frame, scriptUrl) {
    // .contentDocument not IE-compatible
    var fd = frame.contentWindow.document;
    var fscript = fd.createElement('script');
    fscript.setAttribute('type', 'text/javascript');
    fscript.src = scriptUrl;
    fd.body.appendChild(fscript);
  }

  function copyToImports(imports, source) {
    for (var p in source) {
      if (source.hasOwnProperty(p)) {
        // No need to use DefineOwnProperty___ since this is native code and
        // the module function created in es53.js "prepareModule" does the
        // necessary conversion.
        imports[p] = source[p];
      }
    }
  }

  var guestDocumentIdIndex = 0;

  /**
   * Configure a Caja frame group. A frame group maintains a relationship with a
   * Caja server and some configuration parameters. Most Web pages will only
   * need to create one frame group.
   *
   * Recognized configuration parameters are:
   *
   *     cajaServer - whe URL to a Caja server. Except for unique cases,
   *         this must be the server from which the "caja.js" script was
   *         sourced.
   *
   *     debug - whether debugging is supported. At the moment, debug support
   *         means that the files loaded by Caja are un-minified to help with
   *         tracking down problems.
   *
   * @param config an object literal containing configuration paramters.
   * @param callback function to be called back with a reference to
   *     the newly created frame group.
   */
  function configure(config, callback) {
    var cajaServer = String(config.cajaServer) || 'http://caja.appspot.com/';
    var debug = Boolean(config.debug);

    function loadCajaFrame(filename, callback) {
      var iframe = createIframe();

      var url = joinUrl(cajaServer,
          debug ? filename + '.js' : filename + '-minified.js');

      // The particular interleaving of async events shown below has been found
      // necessary to get the right behavior on Firefox 3.6. Otherwise, the
      // iframe silently fails to invoke the cajaIframeDone___ callback.
      setTimeout(function () {
        // Arrange to be notified when the frame is ready. For Firefox, it is
        // important that we do this before we do the async installScript below.
        iframe.contentWindow.cajaIframeDone___ = function () {
          callback(iframe);
        };
        setTimeout(function() {
          installScript(iframe, url);
        }, 0);
      }, 0);
    }

    loadCajaFrame('es53-taming-frame', function (tamingFrame) {
      var tamingWindow = tamingFrame.contentWindow;

      /**
       * Tame an object graph by applying reasonable defaults to all structures
       * reachable from a supplied root object.
       *
       * @param o a root object.
       * @return the root object of a tamed version of the object graph.
       */
      function tame(o) {
        return tamingWindow.___.tame(o);
      }

      /**
       * Mark a host object as "constructed" for the purposes of taming.
       * This must be done before <code>tame()</code> reaches the object.
       *
       * @param o a host object (not a function).
       */
      function markConstructed(o) {
        tamingWindow.___.markTameAsConstructed(o);
      }

      /**
       * Mark a host object as "read/write" for the purposes of taming.
       * This must be done before <code>tame()</code> reaches the object.
       *
       * @param o a host object (not a function).
       */
      function markReadWrite(o) {
        tamingWindow.___.markTameAsReadWrite(o);
      }

      /**
       * Mark a host function as a constructor for the purposes of taming.
       * This must be done before <code>tame()</code> reaches the function.
       *
       * @param ctor a constructor function.
       * @param opt_super the "superclass" constructor function of "ctor".
       */
      function markCtor(ctor, opt_super) {
        tamingWindow.___.markTameAsCtor(ctor, opt_super);
      }

      /**
       * Mark a host function as exophoric for the purposes of taming.
       * This must be done before <code>tame()</code> reaches the function.
       *
       * @param f a function.
       */
      function markXo4a(f) {
        tamingWindow.___.markTameAsXo4a(f);
      }

      /**
       * Make a new ES5 frame.
       *
       * @param div a <DIV> in the parent document within which the guest HTML's
       *     virtual document will be confined. This parameter may be undefined,
       *     in which case a secure DOM document will not be constructed.
       * @param uriCallback a policy callback that is called to allow or
       *     disallow access each time guest code attempts to fetch from a URI.
       *     This is of the form <code>uriCallback(uri, mimeType)</code>, where
       *     <code>uri</code> is a string URI, and <code>mimeType</code> is a
       *     string MIME type based on the context in which the URI is being
       *     requested.
       * @param callback a function that is called back when the newly
       *     constructed ES5 frame has been created.
       */
      function makeES5Frame(div, uriCallback, callback) {
        if (div && (document !== div.ownerDocument)) {
          throw '<div> provided for ES5 frame must be in main document';
        }
      
        loadCajaFrame('es53-guest-frame', function (guestFrame) {
          var guestWindow = guestFrame.contentWindow;
          var imports = {};

          var loader = guestWindow.scriptModuleLoadMaker(
              documentBaseUrl(),
              undefined,  // default module ID resolver
              new guestWindow.CajolingServiceFinder(
                  joinUrl(cajaServer, 'cajole'), debug));

          if (div) {
            var outerContainer = div.ownerDocument.createElement('div');
            var innerContainer = div.ownerDocument.createElement('div');

            outerContainer.setAttribute('class', 'caja_outerContainer___');
            innerContainer.setAttribute('class', 'caja_innerContainer___');                                    

            div.appendChild(outerContainer);
            outerContainer.appendChild(innerContainer);

            // The Domita implementation is obtained from the taming window,
            // since we wish to protect Domita and its dependencies from the
            // ability of guest code to modify the shared primordials.
            tamingWindow.attachDocumentStub(
                '-CajaGadget-' + guestDocumentIdIndex++ + '___',
                uriCallback,
                imports,
                innerContainer);
            imports.htmlEmitter___ =
                new tamingWindow.HtmlEmitter(innerContainer, imports.document);
          }

          /**
           * Run some guest code in this ES5 frame.
           *
           * @param url the URL of a cajoleable "guest" HTML file to load.
           * @param extraImports a map of extra imports to be provided as global
           *     variables to the guest HTML.
           * @param callback a function that is called providing the completion
           *     value of the guest code.
           */
          function run(url, extraImports, callback) {
            if (!extraImports.hasOwnProperty('onerror')) {
              extraImports.onerror = tame(function (message, source, lineNum) {
                console.log('Uncaught script error: ' + message
                    + ' in source: "' + source + '" at line: ' + lineNum);
              });
            }
            copyToImports(imports, extraImports);
            guestWindow.Q.when(loader.async(url), function (moduleFunc) {
              callback(moduleFunc(imports));
            });
          }

          // An ES5 frame
          callback({
            run: run,
            iframe: guestFrame,
            imports: imports,
            loader: loader
          });
        });
      }

      // A frame group
      callback({
        tame: tame,
        markConstructed: markConstructed,
        markReadWrite: markReadWrite,
        markCtor: markCtor,
        markXo4a: markXo4a,
        iframe: tamingFrame,
        makeES5Frame: makeES5Frame
      });
    });
  }

  // Apply styles to current document
  (function() {
    var style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.innerHTML =
        '.caja_outerContainer___ {' +
        '  padding: 0px;' +
        '  margin: 0px;' +
        '  display: inline;' +
        '}' +
        '.caja_innerContainer___, .caja_outerContainer___ > * {' +
        '  padding: 0px;' +
        '  margin: 0px;' +
        '  height: 100%;' +
        '  position: relative;' +
        '  overflow: hidden;' +
        '  clip: rect(0px, 0px, 0px, 0px);' +
        '}';
    document.getElementsByTagName('head')[0].appendChild(style);
  })();

  // The global singleton Caja object
  return {
    configure: configure
  };
})();
