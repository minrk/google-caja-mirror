// Copyright (C) 2009 Google Inc.
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
 * Each load maker object, given the absolute URL of the current module, an
 * identifier resolver, and a cajoler finder, returns a load object.
 *
 * A load object is a function object; load() returns a module object,
 * given its module identifier.
 * load.async() returns a promise to the module, given the module identifier.
 * 
 * What a module identifier is is entirely up to the identifier resolver. The
 * identifier resolver is a function of two parameters, (current module 
 * absolute URL, module identifier), returning the absolute URL for the
 * identified module. The default module identifier resolver considers the
 * module identifier to be a relative URL.
 * 
 * The cajoler finder is a function which should take an absolute module URL
 * and return a URL for cajoled code to load as if by a <script> element. (It
 * need not point to an actual cajoling service and could instead use static
 * .out.js files, depending on the application.)
 *
 * Note that this system never actually fetches the module absolute URL, only
 * passes it to the cajoler. But it *is* used as a key in the cache of loaded
 * modules, so a module absolute URL should always have the same module.
 * 
 * To obtain the dependencies of this file, load:
 *   cajita.js, bridal.js, uri.js, cajita-promise.js
 * 
 * TODO(kpreid): explain static (sync) loading module id semantics.
 * @author maoziqing@gmail.com, kpreid@switchb.org, ihab.awad@gmail.com
 * @requires eval, document, ___, Q, URI, window, console
 * @provides scriptModuleLoadMaker, clearModuleCache,
 *           defaultModuleIdResolver, defaultCajolerFinder,
 *           CajolingServiceFinder
 */
var scriptModuleLoadMaker;
var defaultModuleIdResolver;
var defaultCajolerFinder;
var CajolingServiceFinder;
var clearModuleCache;

(function() {
  // Map from absolute module URLs to module objects.
  var cache = {};

  defaultModuleIdResolver = function(thisModURL, mid) {
    if (!/\.js$/.test(mid) && !/\.html$/.test(mid)) {
      mid = mid + '.js';
    }
    return URI.resolve(URI.parse(thisModURL), URI.parse(mid)).toString();
  };

  /**
   * Constructor for a cajoler finder given the URL of a cajoling service.
   */
  CajolingServiceFinder = function(serviceURL, debug) {
    return  function cajolingServiceFinder(uncajoledSourceURL, jsonpCallback) {
      var inputMimeType;
      if (/\.js$/.test(uncajoledSourceURL)) {
        inputMimeType = 'application/javascript';
      } else if (/\.html$/.test(uncajoledSourceURL)) {
        inputMimeType = 'text/html';
      } else {
        inputMimeType = 'application/javascript';
      }

      return jsonpCallback
          ? serviceURL +
              '?url=' + encodeURIComponent(uncajoledSourceURL) +
              '&directive=ES53' +
              '&emit-html-in-js=true' +
              '&renderer=' + (debug ? 'pretty' : 'minimal') +
              '&input-mime-type=' + inputMimeType +
              '&output-mime-type=application/json' +
              '&callback=' + jsonpCallback +
              '&alt=json-in-script'
          : serviceURL +
              '?url=' + encodeURIComponent(uncajoledSourceURL) +
              '&directive=ES53' +
              '&emit-html-in-js=true' +
              '&renderer=' + (debug ? 'pretty' : 'minimal') +
              '&input-mime-type=' + inputMimeType +
              '&output-mime-type=application/javascript' +
              '&alt=json';
    };
  };
  
  defaultCajolerFinder = new CajolingServiceFinder(
      'http://caja.appspot.com/cajole');

  function syncLoad(modURL) {
    if (cache[modURL] === undefined || Q.near(cache[modURL]).isPromise___) {
      var msg = "The static module " + modURL + " cannot be resolved.";
      console.log(msg);
      throw new Error(msg);
    }
    return Q.near(cache[modURL]);
  }

  function loadMaker(thisModURL, midResolver, cajolerFinder, asyncLoad) {
    var load = function(mid) {
      return syncLoad(midResolver(thisModURL, mid));
    };

    var async = function(mid) {
      return asyncLoad(midResolver(thisModURL, mid),
                       midResolver, cajolerFinder);
    };

    var asyncAll = function(moduleNames) {
      var r = Q.defer();
      var i;
      var modulePromises = [];
      var modules = {};

      for (i = 0; i < moduleNames.length; ++i) {
        modulePromises[i] = async(moduleNames[i]);
      }

      var waitNext = function(idx) {
        if (idx === moduleNames.length) {
          r.resolve(modules);
        } else {
          Q.when( modulePromises[idx], function(theModule) {
            modules[moduleNames[idx]] = theModule;
            waitNext(idx + 1);
          }, function(reason) {
            r.resolve(Q.reject(reason));
          });
        }
      };
      waitNext(0);
      return r.promise();
    };

    load.DefineOwnProperty___('async', {
          value: ___.markFuncFreeze(async),
          writable: false,
          enumerable: true,
          configurable: false
        });
    load.DefineOwnProperty___('asyncAll', {
          value: ___.markFuncFreeze(asyncAll),
          writable: false,
          enumerable: true,
          configurable: false
        });
    return ___.markFuncFreeze(load);
  }

  function resolveDependency(module, load) {
    var r = Q.defer();
    if (module.includedModules !== undefined
        && module.includedModules.length !== 0) {
      var size = module.includedModules.length;
      var count = 0;
      for (var i = 0; i < size; i++) {
        var mid = module.includedModules[i];
        var m = load.async(mid);
        Q.when(m, function(childModule) {
                    count++;
                    if (count === size) {
                      r.resolve(true);
                    }
                  },
                  function(reason) {
                    r.resolve(Q.reject(
                        "Retrieving the module " + mid + " failed."));
                  });
      }
    } else {
      r.resolve(true);
    }
    return r.promise;
  }

  function noop() {}
  
  /** 
   * Given a method of async loading, produce the load-maker that the client
   * will use.
   */
  function makeConcreteLoadMaker(asyncLoadFunction) {
    return ___.markFuncFreeze(function(mid, midResolver, cajolerFinder) {
      if (midResolver === undefined) {
        midResolver = defaultModuleIdResolver;
      }
      if (cajolerFinder === undefined) {
        cajolerFinder = defaultCajolerFinder;
      }

      return loadMaker(mid, midResolver, cajolerFinder, asyncLoadFunction);
    });
  }

  var jsonpCallbackCount = 0;

  function messagesToLog(moduleURL, cajolerMessages) {
    if (!cajolerMessages) { return; }
    console.log("Messages cajoling " + moduleURL);
    var msg;
    for (var i = 0; i < cajolerMessages.length; i++) {
      msg = cajolerMessages[i];
      console.log(
          msg.name + '(' + msg.level + ') '
          + msg.type + ': ' + msg.message);
    }
  }

  function scriptAsyncLoad(modURL, midResolver, cajolerFinder) {
    if (cache[modURL] !== undefined) {
      return cache[modURL];
    }

    var r = Q.defer();
    cache[modURL] = r.promise;

    var load = loadMaker(modURL, midResolver, cajolerFinder, scriptAsyncLoad);

    var jsonpCallbackName = '___caja_mod_' + jsonpCallbackCount++ + '___';

    function prepareModule(moduleText) {
      var rawModule = undefined;
      (function() {
        var ___ = { loadModule: function(m) { rawModule = m; } };
        eval(moduleText);
      })();
      return ___.prepareModule(rawModule, load);
    }

    var w = window;  // Caja linter rejects direct assignment to 'window'

    w[jsonpCallbackName] = function(moduleJson) {

      delete w[jsonpCallbackName];
      if (moduleJson.js) {
        var preparedModule = prepareModule(moduleJson.js);
        Q.when(resolveDependency(preparedModule, load),
            function(result) { r.resolve(preparedModule); },
            function(reason) { r.resolve(Q.reject(reason)); });
      } else {
        r.resolve(Q.reject('Cajoling module ' + modURL + ' failed'));
      }
      messagesToLog(modURL, moduleJson.messages);
    };

    var script = document.createElement('script');
    script.src = cajolerFinder(modURL, jsonpCallbackName);
    script.onerror = function() {
      r.resolve(Q.reject('Error loading cajoled module ' + modURL));
    };
    document.getElementsByTagName('head')[0].appendChild(script);

    return r.promise;
  }

  scriptModuleLoadMaker = makeConcreteLoadMaker(scriptAsyncLoad);

  clearModuleCache = ___.markFuncFreeze(function() {
    ___.forOwnKeys(cache, ___.markFuncFreeze(function(k, v) {
      delete cache[k];
    }));
  });
})();
