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
 * Defines an object which can be used to tame Google's public APIs (which
 * are in the namespace "google.*") for use by guest code.
 */
caja.tamingGoogleLoader = (function() {

  function log() {
    // console.log.apply({}, arguments);
  }

  function StringMap() {
    var o;
    try { o = Object.create(null); } catch (e) { o = {}; }
    function safe(k) { return k + '$'; }
    function unsafe(k) { return k.slice(0, -1); }
    return {
      get: function(k) {
        return o[safe(k)];
      },
      set: function(k, v) {
        o[safe(k)] = v;
      },
      delete: function(k) {
        delete o[safe(k)];
      },
      has: function(k) {
        return Object.prototype.hasOwnProperty.call(o, safe(k));
      },
      keys: function(cb) {
        for (var k in o) {
          if (Object.prototype.hasOwnProperty.call(o, k)) {
            cb(unsafe(k));
          }
        }
      }
    };
  }

  function PropertyTamingFlags() {
    var m = caja.iframe.contentWindow.WeakMap();
    return {
      set: function(o, k) {
        if (!m.has(o)) { m.set(o, StringMap()); }
        m.get(o).set(k, true);
      },
      has: function(o, k) {
        return m.has(o) && m.get(o).has(k);
      }
    };
  }

  function EventListenerGroup() {
    var cbs = [];
    return {
      add: function(cb) {
        cbs.push(cb);
      },
      fire: function() {
        for (var i = 0; i < cbs.length; i++) {
          try {
            cbs[i].call({});
          } catch (e) {
            log('Event handler threw: ', e);
          }
        }
      }
    };
  }

  var TamingUtils = function(frame) {

    function type(o) {
      switch (Object.prototype.toString.call(o)) {
        case '[object Undefined]':
        case '[object Null]':
        case '[object Function]':
        case '[object String]':
        case '[object Number]':
        case '[object Date]':
          return 'primitive';
        case '[object Array]':
          return 'array';
        default:
          return 'object';
      }
    }

    function copyArray(o) {
      log('copyArray(' + o + ')');
      var result = [];
      for (var i = 0; i < o.length; i++) {
        log('   [' + i + ']');
        result[i] = copyMixed(o[i]);
      }
      return result;
    }

    function copyObject(o) {
      log('copyObject(' + o + ')');
      var result = {};
      for (var key in o) {
        if (o.hasOwnProperty(key) && !/__$/.test(key)) {
          log('   .' + key);
          result[key] = copyMixed(o[key]);
        }
      }
      return result;
    }

    function copyMixed(o) {
      log('copyMixed(' + o + ')');
      switch (type(o)) {
        case 'primitive':
          return o;
        case 'array':
          return copyArray(o);
        case 'object':
          return copyObject(o);
      }
    }

    function opaqueNode(guestNode) {
      var d = guestNode.ownerDocument.createElement('div');
      frame.domicile.tameNodeAsForeign(d);
      guestNode.appendChild(d);
      return d;
    }

    function opaqueNodeById(id) {
      if (!frame.hasOwnProperty('opaqueNodeByIdCounter___')) {
        frame.opaqueNodeByIdCounter___ = 0;
      }
      var node = frame.untame(frame.imports.document.getElementById(id));
      var d = node.ownerDocument.createElement('div');
      var id = 'opaqueNodeById__' + frame.opaqueNodeByIdCounter___++ + '__' + frame.idSuffix;
      d.setAttribute('id', id);
      frame.domicile.tameNodeAsForeign(d);
      node.appendChild(d);
      return id;
    }

    function copyJson(o) {
      if (o === undefined || o === null) { return o; }
      return JSON.parse(JSON.stringify(o, function(key, value) {
        return /__$/.test(key) ? undefined : value;
      }));
    }

    function identity(o) {
      return o;
    }

    function mapArgs() {
      var mappings = arguments;
      return function(f, self, args) {
        var mappedArgs = args.slice(0);
        for (var i = 0; i < mappedArgs.length && i < mappings.length; i++) {
          mappedArgs[i] = mappings[i](mappedArgs[i]);
        }
        return mappedArgs;
      };
    }

    function mapResult() {
      if (arguments.length !== 1) {
        throw new TypeError("mapResult requires exactly one argument");
      }
      var mapping = arguments[0];
      return function(f, self, result) {
        return mapping(result);
      };
    }

    function forallkeys(obj, cb) {
      for (var k in obj) {
        if (!/.*__$/.test(k)) {
          cb(k);
        }
      }
    }

    return {
      identity: identity,
      copyJson: copyJson,
      copyMixed: copyMixed,
      opaqueNode: opaqueNode,
      opaqueNodeById: opaqueNodeById,
      mapArgs: mapArgs,
      mapResult: mapResult,
      forallkeys: forallkeys,
      StringMap: StringMap
    };
  }

  function makePolicyEvaluator(frame) {

    var WeakMap = caja.iframe.contentWindow.WeakMap;
    var tamingUtils = TamingUtils(frame);

    function targ(obj, policy) {
      if (!policy) { debugger; }
      return policy.__subst__ ? policy : obj;
    }

    var fGrantRead = PropertyTamingFlags();
    var fGrantMethod = PropertyTamingFlags();
    var fMarkFunction = WeakMap();
    var fMarkCtor = WeakMap();
    var fAdviseFunction = WeakMap();

    function grantRead(o, k) {
      if (fGrantRead.has(o, k)) { return; }
      log('  + grantRead');
      frame.grantRead(o, k);
      fGrantRead.set(o, k);
    }

    function grantMethod(o, k) {
      if (fGrantMethod.has(o, k)) { return; }
      frame.grantMethod(o, k);
      log('  + grantMethod');
      fGrantMethod.set(o, k);
    }

    function markFunction(o) {
      if (fMarkFunction.has(o)) { return o; }
      var r = frame.markFunction(o);
      log('  + markFunction');
      fMarkFunction.set(o, true);
      return r;
    }

    function markCtor(o, sup) {
      if (fMarkCtor.has(o)) { return o; }
      var r = frame.markCtor(o, sup);
      log('  + markCtor');
      fMarkCtor.set(o, true);
      return r;
    }

    function adviseFunctionBefore(o, advices) {
      for (var i = 0; i < advices.length; i++) {
        frame.adviseFunctionBefore(o, advices[i]);
      }
      log('  + adviseFunctionBefore');
      return o;
    }

    function adviseFunctionAfter(o, advices) {
      for (var i = 0; i < advices.length; i++) {
        frame.adviseFunctionAfter(o, advices[i]);
      }
      log('  + adviseFunctionAfter');
      return o;
    }

    function adviseFunctionAround(o, advices) {
      for (var i = 0; i < advices.length; i++) {
        frame.adviseFunctionAround(o, advices[i]);
      }
      log('  + adviseFunctionAround');
      return o;
    }

    function adviseFunction(o, policy) {
      if (fAdviseFunction.has(o)) { return; }
      if (policy.__before__) { adviseFunctionBefore(o, policy.__before__); }
      if (policy.__after__) { adviseFunctionAfter(o, policy.__after__); }
      if (policy.__around__) { adviseFunctionAround(o, policy.__around__); }
      fAdviseFunction.set(o, true);
    }

    function defCtor(path, obj, policy) {
      log(path + ' defCtor');

      adviseFunction(obj, policy);

      tamingUtils.forallkeys(policy, function(name) {
        if (!obj[name]) {
          log(path + '.' + name + ' skip');
          return;
        }
        log(path + '.' + name + ' grant static');
        grantRead(obj, name);
        if (typeof policy[name] === 'function') {
          markFunction(obj[name]);
        }
      });
      tamingUtils.forallkeys(policy.prototype, function(name) {
        if (!obj.prototype[name]) {
          log(path + '.prototype.' + name + ' skip');
          return;
        }
        log(path + '.prototype.' + name + ' grant instance');
        if (typeof policy.prototype[name] === 'function') {
          adviseFunction(obj.prototype[name], policy.prototype[name]);
          grantMethod(obj.prototype, name);
        } else {
          grantRead(obj.prototype, name);
        }
      });
      var sup;
      if (policy.__super__ === Object) {
        sup = Object;
      } else {
        sup = window;
        for (var i = 0; i < policy.__super__.length; i++) {
          sup = sup[policy.__super__[i]];
          if (!sup) {
            throw new TypeError(
                'Cannot find path component ' + policy.__super__[i]);
          }
        }
      }

      return markCtor(obj, sup);
    }

    function defFcn(path, obj, policy) {
      log(path + ' defFcn');
      adviseFunction(obj, policy);
      return markFunction(obj);
    }

    function defObj(path, obj, policy) {
      log(path + ' defObj');
      var r = {};
      tamingUtils.forallkeys(policy, function(name) {
        var sub_obj = obj[name];
        if (!sub_obj) {
          log(path + '.' + name + ' skip');
          return;
        }
        var sub_policy = policy[name];
        var sub_path = path + '.' + name;
        var t_sub_policy = typeof sub_policy;
        if (t_sub_policy === 'function') {
          if (sub_policy.__super__) {
            r[name] = defCtor(sub_path, targ(sub_obj, sub_policy), sub_policy);
          } else {
            r[name] = defFcn(sub_path, targ(sub_obj, sub_policy), sub_policy);
          }
        } else if (t_sub_policy === 'object'){
          r[name] = defObj(sub_path, targ(sub_obj, sub_policy), sub_policy);
        } else {
          log(path + '.' + name + ' grant static');
          r[name] = targ(sub_obj, sub_policy);
          grantRead(r, name);
        }
      });
      return frame.markReadOnlyRecord(r);
    }

    function defTopLevelObj(path, obj, policyByName) {
      var policy = {};
      policyByName.keys(function(k) {
        policy[k] = policyByName.get(k).value;
      });
      return defObj(path, obj, policy);
    }

    return {
      defTopLevelObj: defTopLevelObj
    };
  }

  var policyFactoryUrlByName = StringMap();
  var policyFactoryByName = StringMap();
  var pendingPolicyFactoryLoadByName = StringMap();

  function addPolicyFactoryUrl(name, url) {
    policyFactoryUrlByName.set(name, url);
  }

  function addPolicyFactory(name, factory) {
    policyFactoryByName.set(name, factory);
    if (pendingPolicyFactoryLoadByName.has(name)) {
      pendingPolicyFactoryLoadByName.get(name).fire();
      pendingPolicyFactoryLoadByName.delete(name);
    }
  }

  function addScript(url) {
    var s = document.createElement('script');
    s.setAttribute('src', url);
    document.head.appendChild(s);
  }

  function loadPolicyFactory(name, cb) {
    if (!pendingPolicyFactoryLoadByName.has(name)) {
      addScript(policyFactoryUrlByName.get(name));
      pendingPolicyFactoryLoadByName.set(name, EventListenerGroup());
    }
    pendingPolicyFactoryLoadByName.get(name).add(cb);
  }

  function maybeLoadPolicyFactory(name, cb) {
    if (policyFactoryByName.has(name)) { cb(); }
    else { loadPolicyFactory(name, cb); }
  }

  function loadGoogleApi(name, version, opt_info, cb) {
    // We *always* call google.load() in response to the guest calling our
    // tamed google.load(), because each call, even with the same API name,
    // can pull in different functionality. We rely on the native google.load()
    // to be idempotent (which it is) and do the right thing.
    if (!opt_info) { opt_info = {}; }
    opt_info.callback = cb;
    google.load(name, version, opt_info);
  }

  function applyToFrame(frame, initialEntries) {

    // TODO(ihab.awad): redundant!!!
    var tamingUtils = TamingUtils(frame);

    var onloads = EventListenerGroup();
    var loadWasCalled = false;
    var framePolicyByName = tamingUtils.StringMap();
    var whitelistedApis = tamingUtils.StringMap();
    var policyEvaluator = makePolicyEvaluator(frame);

    function apply() {

      var safeGoogle = policyEvaluator.defTopLevelObj(
          'google', window['google'], framePolicyByName);

      for (var key in initialEntries) {
        if (initialEntries.hasOwnProperty(key) && !/__$/.test(key)) {
          safeGoogle[key] = initialEntries[key];
        }
      }

      safeGoogle.load = frame.markFunction(function(name, opt_ver, opt_info) {
        if (!whitelistedApis.has(name)) {
          // This is our front line of defense against a malicious guest
          // trying to break us by supplying a dumb API name like '__proto__'.
          throw 'API ' + name + ' is not whitelisted for your application';
        }

        loadWasCalled = true;
        var guestCallback = undefined;

        if (opt_info) {
          guestCallback = opt_info.callback;
          opt_info.callback = undefined;
          opt_info = tamingUtils.copyJson(opt_info);
        }

        maybeLoadPolicyFactory(name, function() {
          var policy = policyFactoryByName
              .get(name)
              .call({}, frame, tamingUtils);
          framePolicyByName.set(name, policy);
          loadGoogleApi(name, policy.version, opt_info, function() {
            apply();
            if (onloads) { onloads.fire(); }
            onloads = undefined;
            guestCallback && guestCallback.call({});
          });
        });
      });

      safeGoogle.setOnLoadCallback = frame.markFunction(function(cb) {
        if (onloads) { onloads.add(cb); }
      });

      var g = frame.tame(safeGoogle);
      var w = caja.iframe.contentWindow;
      w.___ && w.___.copyToImports
          ? w.___.copyToImports(frame.imports, { google: g })
          : frame.imports.google = g;
    }

    function signalOnload() {
      // After the guest code loads, we call its 'onload' right away if it has
      // not made any 'google.load()' calls. Otherwise, we need to wait until
      // the load() requests return.
      if (!loadWasCalled) {
        onloads.fire();
        onloads = undefined;
      }
    }

    function whitelistApi(name) {
      if (!policyFactoryUrlByName.has(name) && !policyFactoryByName.has(name)) {
        throw 'API ' + name + ' has no known policy factory';
      }
      whitelistedApis.set(name, true);
    }

    apply();

    return {
      signalOnload: signalOnload,
      whitelistApi: whitelistApi
    };
  }

  return {
    addPolicyFactoryUrl: addPolicyFactoryUrl,
    addPolicyFactory: addPolicyFactory,
    applyToFrame: applyToFrame
  };
})();
