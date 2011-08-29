// Copyright (C) 2008-2011 Google Inc.
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
 * @fileoverview
 * A partially tamed browser object model based on
 * <a href="http://www.w3.org/TR/DOM-Level-2-HTML/Overview.html"
 * >DOM-Level-2-HTML</a> and specifically, the
 * <a href="http://www.w3.org/TR/DOM-Level-2-HTML/ecma-script-binding.html"
 * >ECMAScript Language Bindings</a>.
 *
 * Caveats:<ul>
 * <li>This is not a full implementation.
 * <li>Security Review is pending.
 * <li><code>===</code> and <code>!==</code> on node lists will not
 *   behave the same as with untamed node lists.  Specifically, it is
 *   not always true that {@code nodeA.childNodes === nodeA.childNodes}.
 * <li>Node lists are not "live" -- do not reflect changes in the DOM.
 * </ul>
 *
 * <p>
 * TODO(ihab.awad): Our implementation of getAttribute (and friends)
 * is such that standard DOM attributes which we disallow for security
 * reasons (like 'form:enctype') are placed in the "virtual" attributes
 * map (node._d_attributes). They appear to be settable and gettable,
 * but their values are ignored and do not have the expected semantics
 * per the DOM API. This is because we do not have a column in
 * html4-defs.js stating that an attribute is valid but explicitly
 * blacklisted. Alternatives would be to always throw upon access to
 * these attributes; to make them always appear to be null; etc. Revisit
 * this decision if needed.
 *
 * @author mikesamuel@gmail.com (original Domita)
 * @author kpreid@switchb.org (port to ES5)
 * @requires console
 * @requires cssparser, bridalMaker, css, html, html4, unicode
 * @requires cajaVM, WeakMap, Proxy
 * @provides Domado
 * @overrides domitaModules
 */
// TODO(kpreid): Review whether multiple uses of np() should be coalesced for
// efficiency.

'use strict';

// TODO(kpreid): Move this from the global scope into the function(){}();
// eliminate the domitaModules object (or possibly move more stuff into it).
var domitaModules;
if (!domitaModules) { domitaModules = {}; }

domitaModules.proxiesAvailable = typeof Proxy !== 'undefined';

// The proxy facilities provided by Firefox and ES5/3 differ in whether the
// proxy itself (or rather 'receiver') is the first argument to the 'get' traps.
// This autoswitches as needed, removing the first argument.
domitaModules.permuteProxyGetSet = (function () {
  var needToSwap = false;
  
  if (domitaModules.proxiesAvailable) {
    var testHandler = {
      set: function (a, b, c) {
        if (a === proxy && b === "foo" && c === 1) {
          needToSwap = true;
        } else if (a === "foo" && b === 1 && c === proxy) {
          // needToSwap already false
        } else if (a === "foo" && b === 1 && c === undefined) {
          throw new Error('Proxy implementation does not provide proxy '
              + 'parameter: ' + Array.prototype.slice.call(arguments, 0));
        } else {
          throw new Error('internal: Failed to understand proxy arguments: '
              + Array.prototype.slice.call(arguments, 0));
        }
        return true;
      }
    };
    var proxy = Proxy.create(testHandler);
    proxy.foo = 1;
  }
  
  if (needToSwap) {
    return {
      getter: function (getFunc) {
        return function(proxy, name) {
          return getFunc.call(this, name, proxy);
        };
      },
      setter: function (setFunc) {
        return function(proxy, name, value) {
          return setFunc.call(this, name, value, proxy);
        };
      }
    };
  } else {
    return {
      getter: function (getFunc) { return getFunc; },
      setter: function (setFunc) { return setFunc; }
    };
  }
})();

domitaModules.canHaveEnumerableAccessors = (function () {
  // Firefox bug causes enumerable accessor properties to appear as own
  // properties of children. SES patches this by prohibiting enumerable
  // accessor properties. We work despite the bug by making all such
  // properties non-enumerable using this flag.
  try {
    Object.defineProperty({}, "foo", {
      enumerable: true,
      configurable: false,
      get: function () {}
    });
    return true;
  } catch (e) {
    return false;
  }
})();

domitaModules.getPropertyDescriptor = function (o, n) {
  if (o === null || o === undefined) {
    return undefined;
  } else {
    return Object.getOwnPropertyDescriptor(o, n)
        || domitaModules.getPropertyDescriptor(Object.getPrototypeOf(o), n);
  }
};

// This is a simple forwarding proxy handler. Code copied 2011-05-24 from
// <http://wiki.ecmascript.org/doku.php?id=harmony:proxy_defaulthandler>
// with modifications to make it work on ES5-not-Harmony-but-with-proxies as
// provided by Firefox 4.0.1.
domitaModules.ProxyHandler = function (target) {
  this.target = target;
};
domitaModules.ProxyHandler.prototype = {
  // == fundamental traps ==

  // Object.getOwnPropertyDescriptor(proxy, name) -> pd | undefined
  getOwnPropertyDescriptor: function(name) {
    var desc = Object.getOwnPropertyDescriptor(this.target, name);
    if (desc !== undefined) { desc.configurable = true; }
    return desc;
  },

  // Object.getPropertyDescriptor(proxy, name) -> pd | undefined
  getPropertyDescriptor: function(name) {
    var desc = Object.getPropertyDescriptor(this.target, name);
    if (desc !== undefined) { desc.configurable = true; }
    return desc;
  },

  // Object.getOwnPropertyNames(proxy) -> [ string ]
  getOwnPropertyNames: function() {
    return Object.getOwnPropertyNames(this.target);
  },

  // Object.getPropertyNames(proxy) -> [ string ]
  getPropertyNames: function() {
    return Object.getPropertyNames(this.target);
  },

  // Object.defineProperty(proxy, name, pd) -> undefined
  defineProperty: function(name, desc) {
    return Object.defineProperty(this.target, name, desc);
  },

  // delete proxy[name] -> boolean
  delete: function(name) { return delete this.target[name]; },

  // Object.{freeze|seal|preventExtensions}(proxy) -> proxy
  fix: function() {
    // As long as target is not frozen, the proxy won't allow itself to be fixed
    if (!Object.isFrozen(this.target)) {
      return undefined;
    }
    var props = {};
    for (var name in this.target) {
      props[name] = Object.getOwnPropertyDescriptor(this.target, name);
    }
    return props;
  },

  // == derived traps ==

  // name in proxy -> boolean
  has: function(name) { return name in this.target; },

  // ({}).hasOwnProperty.call(proxy, name) -> boolean
  hasOwn: function(name) {
    return ({}).hasOwnProperty.call(this.target, name);
  },

  // proxy[name] -> any
  get: domitaModules.permuteProxyGetSet.getter(
      function(name, proxy) { return this.target[name]; }),

  // proxy[name] = value
  set: domitaModules.permuteProxyGetSet.setter(
      function(name, value, proxy) { this.target[name] = value; }),

  // for (var name in proxy) { ... }
  enumerate: function() {
    var result = [];
    for (var name in this.target) { result.push(name); };
    return result;
  },

  /*
  // if iterators would be supported:
  // for (var name in proxy) { ... }
  iterate: function() {
    var props = this.enumerate();
    var i = 0;
    return {
      next: function() {
        if (i === props.length) throw StopIteration;
        return props[i++];
      }
    };
  },*/

  // Object.keys(proxy) -> [ string ]
  keys: function() { return Object.keys(this.target); }
};
cajaVM.def(domitaModules.ProxyHandler);


/**
 * Like object[propName] = value, but DWIMs enumerability.
 *
 * This is also used as a workaround for possible bugs/unfortunate-choices in
 * SES, where a non-writable property cannot be overridden by an own property by
 * simple assignment. Or maybe I (kpreid) am misunderstanding what  the right
 * thing is.
 *
 * The property's enumerability is inherited from the ancestor's property's
 * descriptor. The property is not writable or configurable.
 *
 * TODO(kpreid): Attempt to eliminate the need for uses of this. Some may be
 * due to a fixed bug in ES5/3.
 */
domitaModules.setOwn = function (object, propName, value) {
  propName += '';
  Object.defineProperty(object, propName, {
    enumerable: domitaModules.getPropertyDescriptor(object, propName)
                    .enumerable,
    value: value
  });
};

/**
 * Checks that a user-supplied callback is a function. Return silently if the
 * callback is valid; throw an exception if it is not valid.
 *
 * TODO(kpreid): Is this conversion to ES5-world OK?
 *
 * @param aCallback some user-supplied "function-like" callback.
 */
domitaModules.ensureValidCallback =
    function (aCallback) {

  if ('function' !== typeof aCallback) {
    throw new Error('Expected function not ' + typeof aCallback);
  }
};

/**
 * This combines trademarks with amplification, and is really a thin wrapper on
 * WeakMap. It allows objects to have an arbitrary collection of private
 * properties, which can only be accessed by those holding the amplifier 'p'
 * (which, in most cases, should be only a particular prototype's methods.)
 * 
 * Unlike trademarks, this does not freeze the object. It is assumed that the
 * caller makes the object sufficiently frozen for its purposes and/or that the
 * private properties are all that needs protection.
 * 
 * This is designed to be more efficient and straightforward than using both
 * trademarks and per-private-property sealed boxes or weak maps.
 *
 * Capability design note: This facility provides sibling amplification (the
 * ability for one object to access the private state of other similar
 * objects).
 */
domitaModules.Confidence = (function () {
  var setOwn = domitaModules.setOwn;

  function Confidence(typename) {
    var table = new WeakMap();
    
    this.confide = cajaVM.def(function (object, opt_sameAs) {
      //console.debug("Confiding:", object);
      if (table.get(object) !== undefined) {
        if (table.get(object)._obj !== object) {
          throw new Error("WeakMap broke! " + object + " vs. " +
              table.get(object)._obj);
        }
        throw new Error(typename + " has already confided in " + object);
      }
      
      var privates;
      var proto = Object.getPrototypeOf(object);
      if (opt_sameAs !== undefined) {
        privates = this.p(opt_sameAs);
      } else {
        privates = {_obj: object};
      }
      
      table.set(object, privates);
    });
    
    var guard = this.guard = cajaVM.makeTableGuard(table, typename,
        'Specimen does not have the "' + typename + '" confidence mark');
    
    /**
     * Wrap a method to enforce that 'this' is a confidant, and also freeze it.
     *
     * This plays the role ___.grantTypedMethod did in Domita.
     */
    this.protectMethod = function (method) {
      cajaVM.def(method);  // unnecessary in theory
      function protectedMethod(var_args) {
        return method.apply(guard.coerce(this), arguments);
      }
      setOwn(protectedMethod, "toString", cajaVM.def(function () {
        // TODO(kpreid): this causes function body spamminess in firebug
        return "[" + typename + "]" + method.toString();
      }));
      return cajaVM.def(protectedMethod);
    };
    
    
    /**
     * Get the private properties of the object, or throw.
     */
    this.p = cajaVM.def(function (object) {
      var p = table.get(object);
      if (p === undefined) {
        guard.coerce(object);  // borrow failure
        throw new Error("can't happen");
      } else {
        return p;
      }
    });

    this.typename = typename;
  }
  setOwn(Confidence.prototype, "toString", Object.freeze(function () {
    return this.typename + 'Confidence'; 
  }));
  
  return cajaVM.def(Confidence);
})();

domitaModules.ExpandoProxyHandler = (function () {
  var getPropertyDescriptor = domitaModules.getPropertyDescriptor;
  var ProxyHandler = domitaModules.ProxyHandler;
  
  /**
   * A handler for a proxy which implements expando properties by forwarding
   * them to a separate object associated (by weak map) with the real node.
   *
   * The {@code target} is treated as if it were the prototype of this proxy,
   * and the expando properties as own properties of this proxy, except that
   * expando properties cannot hide target properties.
   *
   * The client SHOULD call ExpandoProxyHandler.register(proxy, target) to
   * enable use of ExpandoProxyHandler.unwrap.
   * TODO(kpreid): Wouldn't this mapping better be handled just by the client
   * since this is not defensively consistent and we don't need it here?
   * 
   * Note the following exophoric hazard: if there are multiple expando
   * proxies with the same {@code storage}, and an accessor property is set on
   * one, and then that property is read on the other, the {@code this} seen
   * by the accessor get/set functions will be the latter proxy rather than
   * the former. Therefore, it should never be the case that two expando
   * proxies have the same storage and provide different authority, unless every
   * proxy which is editable provides a superset of the authority provided by
   * all others (which is the case for the use with TameNodes in Domado).
   *
   * @param {Object} target The tame node to forward methods to.
   * @param {boolean} editable Whether modifying the properties is allowed.
   * @param {Object} storage The object to store the expando properties on.
   */
  function ExpandoProxyHandler(target, editable, storage) {
    this.editable = editable;
    this.storage = storage;
    this.target = target;
  }
  var expandoProxyTargets = new WeakMap();
  // Not doing this because it implements all the derived traps, requiring
  // us to do the same. Instead, we use its prototype selectively, whee.
  //inherit(ExpandoProxyHandler, ProxyHandler);

  ExpandoProxyHandler.register = function (proxy, handler) {
    expandoProxyTargets.set(proxy, handler);
  };

  /**
   * If obj is an expando proxy, return the underlying object. This is used
   * to apply non-expando properties to the object outside of its constructor.
   *
   * This is not robust against spoofing because it is only used during
   * initialization.
   */
  ExpandoProxyHandler.unwrap = function (obj) {
    return expandoProxyTargets.has(obj) ? expandoProxyTargets.get(obj) : obj;
  };
  
  ExpandoProxyHandler.prototype.getOwnPropertyDescriptor = function (name) {
    if (name === "ident___") {
      // Caja WeakMap emulation internal property
      return Object.getOwnPropertyDescriptor(this, "ident");
    } else {
      return Object.getOwnPropertyDescriptor(this.storage, name);
    }
  };
  ExpandoProxyHandler.prototype.getPropertyDescriptor = function (name) {
    var desc = this.getOwnPropertyDescriptor(name)
        || getPropertyDescriptor(this.target, name);
    return desc;
  };
  ExpandoProxyHandler.prototype.getOwnPropertyNames = function () {
    return Object.getOwnPropertyNames(
        this.storage || {});
  };
  ExpandoProxyHandler.prototype.defineProperty = function (name, descriptor) {
    if (name === "ident___") {
      if (descriptor.set === null) descriptor.set = undefined;
      Object.defineProperty(this, "ident", descriptor);
    } else if (name in this.target) {
      // Forwards everything already defined (not expando).
      return ProxyHandler.prototype.defineProperty.call(this, name, descriptor);
    } else {
      if (!this.editable) { throw new Error("Not editable"); }
      Object.defineProperty(this.storage, name, descriptor);
      return true;
    }
    return false;
  };
  ExpandoProxyHandler.prototype.delete = function (name) {
    if (name === "ident___") {
      return false;
    } else if (name in this.target) {
      // Forwards everything already defined (not expando).
      return ProxyHandler.prototype.delete.call(this, name);
    } else {
      if (!this.editable) { throw new Error("Not editable"); }
      return delete this.storage[name];
    }
    return false;
  };
  ExpandoProxyHandler.prototype.fix = function () {
    // TODO(kpreid): Implement fixing, because it is possible to freeze a
    // host DOM node and so ours should support it too.
    return undefined;
  };
  
  // Derived traps
  ExpandoProxyHandler.prototype.get = domitaModules.permuteProxyGetSet.getter(
      function (name) {
    // Written for an ES5/3 bug, but probably useful for efficiency too.
    if (name === "ident___") {
      // Caja WeakMap emulation internal property
      return this.ident;
    } else if (Object.prototype.hasOwnProperty.call(this.storage, name)) {
      return this.storage[name];
    } else {
      return this.target[name];
    }
  });
  ExpandoProxyHandler.prototype.enumerate = function () {
    // This derived trap shouldn't be necessary, but Firebug won't complete
    // properties without it (FF 4.0.1, Firebug 1.7.1, 2011-06-02).
    var names = [];
    for (var k in this.target) names.push(k);
    for (var k in this.storage) names.push(k);
    return names;
  };
  ExpandoProxyHandler.prototype.set = domitaModules.permuteProxyGetSet.setter(
      function (name, val, receiver) {
    // NOTE: this was defined to work around what might be a FF4 or FF4+initSES
    // bug or a bug in our get[Own]PropertyDescriptor that made the innerHTML
    // setter not be invoked.
    // It is, in fact, an exact copy of the default derived trap code from
    // https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Proxy
    // as of 2011-05-25.
    var desc = this.getOwnPropertyDescriptor(name);
    if (desc) {
      if ('writable' in desc) {
        if (desc.writable) {
          desc.value = val;
          this.defineProperty(name, desc);
          return true;
        } else {
          return false;
        }
      } else { // accessor
        if (desc.set) {
          desc.set.call(receiver, val);
          return true;
        } else {
          return false;
        }
      }
    }
    desc = this.getPropertyDescriptor(name);
    if (desc) {
      if ('writable' in desc) {
        if (desc.writable) {
          // fall through
        } else {
          return false;
        }
      } else { // accessor
        if (desc.set) {
          desc.set.call(receiver, val);
          return true;
        } else {
          return false;
        }
      }
    }
    this.defineProperty(name, {
      value: val,
      writable: true,
      enumerable: true,
      configurable: true});
    return true;
  });
  
  return cajaVM.def(ExpandoProxyHandler);
})();

/** XMLHttpRequest or an equivalent on IE 6. */
domitaModules.XMLHttpRequestCtor = function (XMLHttpRequest, ActiveXObject) {
  if (XMLHttpRequest) {
    return XMLHttpRequest;
  } else if (ActiveXObject) {
    // The first time the ctor is called, find an ActiveX class supported by
    // this version of IE.
    var activeXClassId;
    return function ActiveXObjectForIE() {
      if (activeXClassId === void 0) {
        activeXClassId = null;
        /** Candidate Active X types. */
        var activeXClassIds = [
            'MSXML2.XMLHTTP.5.0', 'MSXML2.XMLHTTP.4.0',
            'MSXML2.XMLHTTP.3.0', 'MSXML2.XMLHTTP',
            'MICROSOFT.XMLHTTP.1.0', 'MICROSOFT.XMLHTTP.1',
            'MICROSOFT.XMLHTTP'];
        for (var i = 0, n = activeXClassIds.length; i < n; i++) {
          var candidate = activeXClassIds[+i];
          try {
            void new ActiveXObject(candidate);
            activeXClassId = candidate;
            break;
          } catch (e) {
            // do nothing; try next choice
          }
        }
        activeXClassIds = null;
      }
      return new ActiveXObject(activeXClassId);
    };
  } else {
    throw new Error('ActiveXObject not available');
  }
};

domitaModules.TameXMLHttpRequest = function(
    rulebreaker,
    xmlHttpRequestMaker,
    uriCallback) {
  var Confidence = domitaModules.Confidence;
  var setOwn = domitaModules.setOwn;
  var canHaveEnumerableAccessors = domitaModules.canHaveEnumerableAccessors;
  // See http://www.w3.org/TR/XMLHttpRequest/

  // TODO(ihab.awad): Improve implementation (interleaving, memory leaks)
  // per http://www.ilinsky.com/articles/XMLHttpRequest/

  var TameXHRConf = new Confidence('TameXMLHttpRequest');
  var p = TameXHRConf.p.bind(TameXHRConf);
  var method = TameXHRConf.protectMethod;

  // Note: Since there is exactly one TameXMLHttpRequest per feral XHR, we do
  // not use an expando proxy and always let clients set expando properties
  // directly on this. This simplifies implementing onreadystatechange.
  function TameXMLHttpRequest() {
    TameXHRConf.confide(this);
    var xhr = p(this).feral =
        rulebreaker.makeDOMAccessible(new xmlHttpRequestMaker());
    rulebreaker.permitUntaming(this);
  }
  Object.defineProperties(TameXMLHttpRequest.prototype, {
    onreadystatechange: {
      enumerable: canHaveEnumerableAccessors,
      set: method(function (handler) {
        // TODO(ihab.awad): Do we need more attributes of the event than
        // 'target'? May need to implement full "tame event" wrapper similar to
        // DOM events.
        var self = this;
        p(this).feral.onreadystatechange = rulebreaker.untame(function (event) {
          var evt = { target: self };
          return handler.call(void 0, evt);
        });
        // Store for later direct invocation if need be
        p(this).handler = handler;
      })
    },
    readyState: {
      enumerable: canHaveEnumerableAccessors,
      get: method(function () {
        // The ready state should be a number
        return Number(p(this).feral.readyState);
      })
    },
    responseText: {
      enumerable: canHaveEnumerableAccessors,
      get: method(function () {
        var result = p(this).feral.responseText;
        return (result === undefined || result === null) ?
          result : String(result);
      })
    },
    responseXML: {
      enumerable: canHaveEnumerableAccessors,
      get: method(function () {
        // TODO(ihab.awad): Implement a taming layer for XML. Requires
        // generalizing the HTML node hierarchy as well so we have a unified
        // implementation.
        return {};
      })
    },
    status: {
      enumerable: canHaveEnumerableAccessors,
      get: method(function () {
        var result = p(this).feral.status;
        return (result === undefined || result === null) ?
          result : Number(result);
      })
    },
    statusText: {
      enumerable: canHaveEnumerableAccessors,
      get: method(function () {
        var result = p(this).feral.statusText;
        return (result === undefined || result === null) ?
          result : String(result);
      })
    }
  });
  TameXMLHttpRequest.prototype.open = method(function (
      method, URL, opt_async, opt_userName, opt_password) {
    method = String(method);
    // The XHR interface does not tell us the MIME type in advance, so we
    // must assume the broadest possible.
    var safeUri = uriCallback.rewrite(
        String(URL), html4.ueffects.SAME_DOCUMENT, html4.ltypes.SANDBOXED,
        { "XHR": true});
    // If the uriCallback rejects the URL, we throw an exception, but we do not
    // put the URI in the exception so as not to put the caller at risk of some
    // code in its stack sniffing the URI.
    if ("string" !== typeof safeUri) { throw 'URI violates security policy'; }
    switch (arguments.length) {
    case 2:
      p(this).async = true;
      p(this).feral.open(method, safeUri);
      break;
    case 3:
      p(this).async = opt_async;
      p(this).feral.open(method, safeUri, Boolean(opt_async));
      break;
    case 4:
      p(this).async = opt_async;
      p(this).feral.open(
          method, safeUri, Boolean(opt_async), String(opt_userName));
      break;
    case 5:
      p(this).async = opt_async;
      p(this).feral.open(
          method, safeUri, Boolean(opt_async), String(opt_userName),
          String(opt_password));
      break;
    default:
      throw 'XMLHttpRequest cannot accept ' + arguments.length + ' arguments';
      break;
    }
  });
  TameXMLHttpRequest.prototype.setRequestHeader = method(
      function (label, value) {
    p(this).feral.setRequestHeader(String(label), String(value));
  });
  TameXMLHttpRequest.prototype.send = method(function(opt_data) {
    if (arguments.length === 0) {
      // TODO(ihab.awad): send()-ing an empty string because send() with no
      // args does not work on FF3, others?
      p(this).feral.send('');
    } else if (typeof opt_data === 'string') {
      p(this).feral.send(opt_data);
    } else /* if XML document */ {
      // TODO(ihab.awad): Expect tamed XML document; unwrap and send
      p(this).feral.send('');
    }

    // Firefox does not call the 'onreadystatechange' handler in
    // the case of a synchronous XHR. We simulate this behavior by
    // calling the handler explicitly.
    if (p(this).feral.overrideMimeType) {
      // This is Firefox
      if (!p(this).async && p(this).handler) {
        var evt = { target: this };
        p(this).handler.call(void 0, evt);
      }
    }
  });
  TameXMLHttpRequest.prototype.abort = method(function () {
    p(this).feral.abort();
  });
  TameXMLHttpRequest.prototype.getAllResponseHeaders = method(function () {
    var result = p(this).feral.getAllResponseHeaders();
    return (result === undefined || result === null) ?
      result : String(result);
  });
  TameXMLHttpRequest.prototype.getResponseHeader = method(
      function (headerName) {
    var result = p(this).feral.getResponseHeader(String(headerName));
    return (result === undefined || result === null) ?
      result : String(result);
  });
  /*SES*/setOwn(TameXMLHttpRequest.prototype, "toString", method(function () {
    return 'Not a real XMLHttpRequest';
  }));

  return cajaVM.def(TameXMLHttpRequest);
};

// TODO(kpreid): Review whether this has unnecessary features (as we're
// statically generating Style accessors rather than proxy/handler-ing
// Domita did).
domitaModules.CssPropertiesCollection =
    function(cssPropertyNameCollection, aStyleObject, css) {
  var canonicalStylePropertyNames = {};
  // Maps style property names, e.g. cssFloat, to property names, e.g. float.
  var cssPropertyNames = {};

  for (var cssPropertyName in cssPropertyNameCollection) {
    var baseStylePropertyName = cssPropertyName.replace(
        /-([a-z])/g, function (_, letter) { return letter.toUpperCase(); });
    var canonStylePropertyName = baseStylePropertyName;
    cssPropertyNames[baseStylePropertyName]
        = cssPropertyNames[canonStylePropertyName]
        = cssPropertyName;
    if (css.alternates.hasOwnProperty(canonStylePropertyName)) {
      var alts = css.alternates[canonStylePropertyName];
      for (var i = alts.length; --i >= 0;) {
        cssPropertyNames[alts[+i]] = cssPropertyName;
        // Handle oddities like cssFloat/styleFloat.
        if (alts[+i] in aStyleObject
            && !(canonStylePropertyName in aStyleObject)) {
          canonStylePropertyName = alts[+i];
        }
      }
    }
    canonicalStylePropertyNames[cssPropertyName] = canonStylePropertyName;
  }

  return {
    isCanonicalProp: function (p) {
      return cssPropertyNames.hasOwnProperty(p);
    },
    isCssProp: function (p) {
      return canonicalStylePropertyNames.hasOwnProperty(p);
    },
    getCanonicalPropFromCss: function (p) {
      return canonicalStylePropertyNames[p];
    },
    getCssPropFromCanonical: function(p) {
      return cssPropertyNames[p];
    },
    forEachCanonical: function (f) {
      for (var p in cssPropertyNames) {
        if (cssPropertyNames.hasOwnProperty(p)) {
          f(p);
        }
      }
    }
  };
};

cajaVM.def(domitaModules);

/**
 * Authorize the Domado library.
 * 
 * The result of this constructor is almost stateless. The exceptions are that
 * each instance has unique trademarks for certain types of tamed objects, and a
 * shared map allowing separate virtual documents to dispatch events across
 * them. (TODO(kpreid): Confirm this explanation is good.)
 *
 * @param {Object} opt_rulebreaker. If necessary, authorities to break the ES5/3
 *     taming membrane and work with the taming-frame system. If running under
 *     SES, pass null instead.
 * @return A record of functions attachDocument, dispatchEvent, and
 *     dispatchToHandler.
 */
function Domado(opt_rulebreaker) {
  // Everything in this scope but not in function attachDocument() below
  // does not contain lexical references to a particular DOM instance, but may
  // have some kind of privileged access to Domado internals.

  // This parameter is supplied in the ES5/3 case and not in the ES5+SES case.
  var rulebreaker = opt_rulebreaker ? opt_rulebreaker : cajaVM.def({
    // These are the stub versions used when in ES5+SES.
    makeDOMAccessible: function (o) {return o;},
    makeFunctionAccessible: function (o) {return o;},
    permitUntaming: function (o) {},
    tame: function (o) {
      return o._domado_tamed;
    },
    untame: function (o) {
      // Suitable for current uses (setting event handlers on host objs), but
      // not general-purpose (because it is not symmetric with 'tame'). Checking
      // that it is only used for said purpose:
      if (typeof o !== 'function') {
        throw new TypeError(
            'default rulebreaker.untame is only a stub for functions');
      }
      return o; 
    },
    tamesTo: function (f,t) {
      f._domado_tamed = t;
    },
    hasTameTwin: function (f) {
      return "_domado_tamed" in f;
    },
    writeToPixelArray: function (source, target, length) {
      // See the use below for why this exists.
      for (var i = length-1; i >= 0; i--) {
        target[+i] = source[+i];
      }
    },
    
    // Use the window (imports) object itself as its own id.
    // TODO(kpreid): Not sure if this will work robustly; pay attention as we
    // build up the Domado-on-SES environment.
    getId: function (imports) {
      return imports;
    },
    getImports: function (id) {
      return id;
    }
  });
  
  var makeDOMAccessible = rulebreaker.makeDOMAccessible;
  var makeFunctionAccessible = rulebreaker.makeFunctionAccessible;
  
  var Confidence = domitaModules.Confidence;
  var ProxyHandler = domitaModules.ProxyHandler;
  var ExpandoProxyHandler = domitaModules.ExpandoProxyHandler;
  var setOwn = domitaModules.setOwn;
  var canHaveEnumerableAccessors = domitaModules.canHaveEnumerableAccessors;
    
  function traceStartup(var_args) {
    //// In some versions, Firebug console's methods have no .apply. In other
    //// versions, Function.prototype.apply cannot be used on them!
    //if (typeof console !== 'undefined') {
    //  if (console.debug.apply) {
    //    console.debug.apply(console, arguments);
    //  } else {
    //    Function.prototype.apply.call(console.debug, console, arguments);
    //  }
    //}
  }
  
  function inherit(sub, souper) {
    sub.prototype = Object.create(souper.prototype);
    Object.defineProperty(sub.prototype, "constructor", {
      value: sub,
      writable: true,
      configurable: true
    }); 
  }
  
  /**
   * For each enumerable p: d in propDescs, do the equivalent of
   *   
   *   Object.defineProperty(object, p, d)
   *
   * except that the property descriptor d can have additional keys:
   * 
   *    extendedAccessors:
   *      If present and true, property accessor functions receive the
   *      property name as an additional argument.
   */
  function definePropertiesAwesomely(object, propDescs) {
    for (var prop in propDescs) {
      var desc = {};
      for (var k in propDescs[prop]) {
        desc[k] = propDescs[prop][k];
      }
      if ('get' in desc || 'set' in desc) {
        // Firefox bug workaround; see comments on canHaveEnumerableAccessors.
        desc.enumerable = desc.enumerable && canHaveEnumerableAccessors;
      }
      if (desc.extendedAccessors) {
        delete desc.extendedAccessors;
        (function (prop, extGet, extSet) {  // @*$#*;%#<$ non-lexical scoping
          if (extGet) {
            desc.get = cajaVM.def(function () {
              return extGet.call(this, prop);
            });
          }
          if (desc.set) {
            desc.set = cajaVM.def(function (value) {
              return extSet.call(this, value, prop);
            });
          }
        })(prop, desc.get, desc.set);
      }
      if (desc.get && !Object.isFrozen(desc.get)) {
        if (typeof console !== 'undefined') {
          console.warn("Getter for ", prop, " of ", object,
              " is not frozen; fixing.");
        }
        cajaVM.def(desc.get);
      }
      if (desc.set && !Object.isFrozen(desc.set)) {
        if (typeof console !== 'undefined') {
          console.warn("Setter for ", prop, " of ", object,
              " is not frozen; fixing.");
        }
        cajaVM.def(desc.set);
      }
      Object.defineProperty(object, prop, desc);
    }
  }
  
  function forOwnKeys(obj, fn) {
    for (var i in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, i)) { continue; }
      fn(i, obj[i]);
    }
  }

  // value transforming functions
  function identity(x) { return x; }
  function defaultToEmptyStr(x) { return x || ''; }
  
  // Array Remove - By John Resig (MIT Licensed)
  function arrayRemove(array, from, to) {
    var rest = array.slice((to || from) + 1 || array.length);
    array.length = from < 0 ? array.length + from : from;
    return array.push.apply(array, rest);
  }
  
  // It is tempting to name this table "burglar".
  var windowToDomicile = new WeakMap();
  
  var TameEventConf = new Confidence('TameEvent');
  var TameEventT = TameEventConf.guard;
  var TameImageDataConf = new Confidence('TameImageData');
  var TameImageDataT = TameImageDataConf.guard;
  var TameGradientConf = new Confidence('TameGradient');
  var TameGradientT = TameGradientConf.guard;

  var eventMethod = TameEventConf.protectMethod;

  // Define a wrapper type for known safe HTML, and a trademarker.
  // This does not actually use the trademarking functions since trademarks
  // cannot be applied to strings.
  var safeHTMLTable = new WeakMap(true);
  function Html(htmlFragment) {
    // Intentionally using == rather than ===.
    var h = String(htmlFragment == null ? '' : htmlFragment);
    safeHTMLTable.put(this, htmlFragment); 
    return cajaVM.def(this);
  }
  function htmlToString() {
    return safeHTMLTable.get(this);
  }
  setOwn(Html.prototype, 'valueOf', htmlToString);
  setOwn(Html.prototype, 'toString', htmlToString);
  function safeHtml(htmlFragment) {
    // Intentionally using == rather than ===.
    return (htmlFragment instanceof Html)
        ? safeHTMLTable.get(htmlFragment)
        : html.escapeAttrib(String(htmlFragment == null ? '' : htmlFragment));
  }
  function blessHtml(htmlFragment) {
    return (htmlFragment instanceof Html)
        ? htmlFragment
        : new Html(htmlFragment);
  }
  cajaVM.def([Html, safeHtml, blessHtml]);

  var XML_SPACE = '\t\n\r ';

  var JS_SPACE = '\t\n\r ';
  // An identifier that does not end with __.
  var JS_IDENT = '(?:[a-zA-Z_][a-zA-Z0-9$_]*[a-zA-Z0-9$]|[a-zA-Z])_?';
  var SIMPLE_HANDLER_PATTERN = new RegExp(
      '^[' + JS_SPACE + ']*'
      + '(return[' + JS_SPACE + ']+)?'  // Group 1 is present if it returns.
      + '(' + JS_IDENT + ')[' + JS_SPACE + ']*'  // Group 2 is a function name.
      // Which can be passed optionally this node, and optionally the event.
      + '\\((?:this'
        + '(?:[' + JS_SPACE + ']*,[' + JS_SPACE + ']*event)?'
        + '[' + JS_SPACE + ']*)?\\)'
      // And it can end with a semicolon.
      + '[' + JS_SPACE + ']*(?:;?[' + JS_SPACE + ']*)$');

  // These id patterns match the ones in HtmlAttributeRewriter.

  var VALID_ID_CHAR =
      unicode.LETTER + unicode.DIGIT + '_'
      + '$\\-.:;=()\\[\\]'
      + unicode.COMBINING_CHAR + unicode.EXTENDER;

  var VALID_ID_PATTERN = new RegExp(
      '^[' + VALID_ID_CHAR + ']+$');

  var VALID_ID_LIST_PATTERN = new RegExp(
      '^[' + XML_SPACE + VALID_ID_CHAR + ']*$');

  var FORBIDDEN_ID_PATTERN = new RegExp('__\\s*$');

  var FORBIDDEN_ID_LIST_PATTERN = new RegExp('__(?:\\s|$)');

  function isValidId(s) {
    return !FORBIDDEN_ID_PATTERN.test(s)
        && VALID_ID_PATTERN.test(s);
  }

  function isValidIdList(s) {
    return !FORBIDDEN_ID_LIST_PATTERN.test(s)
        && VALID_ID_LIST_PATTERN.test(s);
  }

  // Trim whitespace from the beginning and end of a CSS string.
  function trimCssSpaces(input) {
    return input.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '');
  }

  /**
   * The plain text equivalent of a CSS string body.
   * @param {string} s the body of a CSS string literal w/o quotes
   *     or CSS identifier.
   * @return {string} plain text.
   * {@updoc
   * $ decodeCssString('')
   * # ''
   * $ decodeCssString('foo')
   * # 'foo'
   * $ decodeCssString('foo\\\nbar\\\r\nbaz\\\rboo\\\ffar')
   * # 'foobarbazboofar'
   * $ decodeCssString('foo\\000a bar\\000Abaz')
   * # 'foo' + '\n' + 'bar' + '\u0ABA' + 'z'
   * $ decodeCssString('foo\\\\bar\\\'baz')
   * # "foo\\bar'baz"
   * }
   */
  function decodeCssString(s) {
    // Decode a CSS String literal.
    // From http://www.w3.org/TR/CSS21/grammar.html
    //     string1    \"([^\n\r\f\\"]|\\{nl}|{escape})*\"
    //     unicode    \\{h}{1,6}(\r\n|[ \t\r\n\f])?
    //     escape     {unicode}|\\[^\r\n\f0-9a-f]
    //     s          [ \t\r\n\f]+
    //     nl         \n|\r\n|\r|\f
    return s.replace(
        /\\(?:(\r\n?|\n|\f)|([0-9a-f]{1,6})(?:\r\n?|[ \t\n\f])?|(.))/gi,
        function (_, nl, hex, esc) {
          return esc || (nl ? '' : String.fromCharCode(parseInt(hex, 16)));
        });
  }

  /**
   * Sanitize the 'style' attribute value of an HTML element.
   *
   * @param styleAttrValue the value of a 'style' attribute, which we
   * assume has already been checked by the caller to be a plain String.
   *
   * @return a sanitized version of the attribute value.
   */
  function sanitizeStyleAttrValue(styleAttrValue) {
    var sanitizedDeclarations = [];
    cssparser.parse(
        String(styleAttrValue),
        function (property, value) {
          property = property.toLowerCase();
          if (css.properties.hasOwnProperty(property)
              && css.properties[property].test(value + '')) {
            sanitizedDeclarations.push(property + ': ' + value);
          }
        });
    return sanitizedDeclarations.join(' ; ');
  }

  function mimeTypeForAttr(tagName, attribName) {
    if (attribName === 'src') {
      if (tagName === 'img') { return 'image/*'; }
      if (tagName === 'script') { return 'text/javascript'; }
    }
    return '*/*';
  }

  // TODO(ihab.awad): Does this work on IE, where console output
  // goes to a DOM node?
  function assert(cond) {
    if (!cond) {
      if (typeof console !== 'undefined') {
        console.error('domita assertion failed');
        console.trace();
      }
      throw new Error("Domita assertion failed");
    }
  }

  var cssSealerUnsealerPair = cajaVM.makeSealerUnsealerPair();

  /*
   * Implementations of setTimeout, setInterval, clearTimeout, and
   * clearInterval that only allow simple functions as timeouts and
   * that treat timeout ids as capabilities.
   * This is safe even if accessed across frame since the same
   * map is never used with more than one version of setTimeout.
   */
  function tameSetAndClear(target, set, clear, setName, clearName) {
    var ids = new WeakMap();
    makeFunctionAccessible(set);
    makeFunctionAccessible(clear);
    function tameSet(action, delayMillis) {
      // Existing browsers treat a timeout/interval of null or undefined as a
      // noop.
      var id;
      if (action) {
        if (typeof action === 'string') {
          throw new Error(
              setName + ' called with a string.'
              + '  Please pass a function instead of a string of javascript');
        }
        id = set(action, delayMillis | 0);
      } else {
        id = undefined;
      }
      var tamed = {};
      ids.set(tamed, id);
      return tamed;
    }
    function tameClear(id) {
      if (id === null || id === (void 0)) { return; }

      // From https://developer.mozilla.org/en/DOM/window.clearTimeout says:
      //   Notes:
      //   Passing an invalid ID to clearTimeout does not have any effect
      //   (and doesn't throw an exception).
      var feral = ids.get(id);
      if (feral !== undefined) clear(feral);
    }
    target[setName] = cajaVM.def(tameSet);
    target[clearName] = cajaVM.def(tameClear);
    return target;
  }
  
  function makeScrollable(element) {
    var window = bridalMaker.getWindow(element);
    var overflow = null;
    if (element.currentStyle) {
      overflow = element.currentStyle.overflow;
    } else if (window.getComputedStyle) {
      overflow = window.getComputedStyle(element, void 0).overflow;
    } else {
      overflow = null;
    }
    switch (overflow && overflow.toLowerCase()) {
      case 'visible':
      case 'hidden':
        element.style.overflow = 'auto';
        break;
    }
  }

  /**
   * Moves the given pixel within the element's frame of reference as close to
   * the top-left-most pixel of the element's viewport as possible without
   * moving the viewport beyond the bounds of the content.
   * @param {number} x x-coord of a pixel in the element's frame of reference.
   * @param {number} y y-coord of a pixel in the element's frame of reference.
   */
  function tameScrollTo(element, x, y) {
    if (x !== +x || y !== +y || x < 0 || y < 0) {
      throw new Error('Cannot scroll to ' + x + ':' + typeof x + ','
                      + y + ' : ' + typeof y);
    }
    element.scrollLeft = x;
    element.scrollTop = y;
  }

  /**
   * Moves the origin of the given element's view-port by the given offset.
   * @param {number} dx a delta in pixels.
   * @param {number} dy a delta in pixels.
   */
  function tameScrollBy(element, dx, dy) {
    if (dx !== +dx || dy !== +dy) {
      throw new Error('Cannot scroll by ' + dx + ':' + typeof dx + ', '
                      + dy + ':' + typeof dy);
    }
    element.scrollLeft += dx;
    element.scrollTop += dy;
  }

  function guessPixelsFromCss(cssStr) {
    if (!cssStr) { return 0; }
    var m = cssStr.match(/^([0-9]+)/);
    return m ? +m[1] : 0;
  }

  function tameResizeTo(element, w, h) {
    if (w !== +w || h !== +h) {
      throw new Error('Cannot resize to ' + w + ':' + typeof w + ', '
                      + h + ':' + typeof h);
    }
    makeDOMAccessible(element.style);
    element.style.width = w + 'px';
    element.style.height = h + 'px';
  }

  function tameResizeBy(element, dw, dh) {
    if (dw !== +dw || dh !== +dh) {
      throw new Error('Cannot resize by ' + dw + ':' + typeof dw + ', '
                      + dh + ':' + typeof dh);
    }
    if (!dw && !dh) { return; }

    // scrollWidth is width + padding + border.
    // offsetWidth is width + padding + border, but excluding the non-visible
    // area.
    // clientWidth iw width + padding, and like offsetWidth, clips to the
    // viewport.
    // margin does not count in any of these calculations.
    //
    // scrollWidth/offsetWidth
    //   +------------+
    //   |            |
    //
    // +----------------+
    // |                | Margin-top
    // | +------------+ |
    // | |############| | Border-top
    // | |#+--------+#| |
    // | |#|        |#| | Padding-top
    // | |#| +----+ |#| |
    // | |#| |    | |#| | Height
    // | |#| |    | |#| |
    // | |#| +----+ |#| |
    // | |#|        |#| |
    // | |#+--------+#| |
    // | |############| |
    // | +------------+ |
    // |                |
    // +----------------+
    //
    //     |        |
    //     +--------+
    //     clientWidth (but excludes content outside viewport)

    var style = makeDOMAccessible(element.currentStyle);
    if (!style) {
      style = makeDOMAccessible(
          bridalMaker.getWindow(element).getComputedStyle(element, void 0));
    }

    makeDOMAccessible(element.style);

    // We guess the padding since it's not always expressed in px on IE
    var extraHeight = guessPixelsFromCss(style.paddingBottom)
        + guessPixelsFromCss(style.paddingTop);
    var extraWidth = guessPixelsFromCss(style.paddingLeft)
        + guessPixelsFromCss(style.paddingRight);

    var goalHeight = element.clientHeight + dh;
    var goalWidth = element.clientWidth + dw;

    var h = goalHeight - extraHeight;
    var w = goalWidth - extraWidth;

    if (dh) { element.style.height = Math.max(0, h) + 'px'; }
    if (dw) { element.style.width = Math.max(0, w) + 'px'; }

    // Correct if our guesses re padding and borders were wrong.
    // We may still not be able to resize if e.g. the deltas would take
    // a dimension negative.
    if (dh && element.clientHeight !== goalHeight) {
      var hError = element.clientHeight - goalHeight;
      element.style.height = Math.max(0, h - hError) + 'px';
    }
    if (dw && element.clientWidth !== goalWidth) {
      var wError = element.clientWidth - goalWidth;
      element.style.width = Math.max(0, w - wError) + 'px';
    }
  }
  
  /**
   * Add a tamed document implementation to a Gadget's global scope.
   *
   * Has the side effect of adding the classes "vdoc-body___" and
   * idSuffix.substring(1) to the pseudoBodyNode.
   *
   * @param {string} idSuffix a string suffix appended to all node IDs.
   *     It should begin with "-" and end with "___".
   * @param {Object} uriCallback an object like <pre>{
   *   rewrite: function (uri, uriEffect, loaderType, hints) { return safeUri }
   * }</pre>.
   *       * uri: the uri to be rewritten
   *       * uriEffect: the effect that allowing a URI to load has (@see 
   *         UriEffect.java).
   *       * loaderType: type of loader that would load the URI or the rewritten
   *         version.
   *       * hints: record that describes the context in which the URI appears.
   *         If a hint is not present it should not be relied upon.
   *     The rewrite function should be idempotent to allow rewritten HTML
   *     to be reinjected.
   * @param {Node} pseudoBodyNode an HTML node to act as the "body" of the
   *     virtual document provided to Cajoled code.
   * @param {Object} optPseudoWindowLocation a record containing the
   *     properties of the browser "window.location" object, which will
   *     be provided to the Cajoled code.
   * @return {Object} A collection of privileged access tools, plus the tamed
   *     {@code document} and {@code window} objects under those names. This
   *     object is known as a "domicile".
   */
  function attachDocument(
      idSuffix, uriCallback, pseudoBodyNode, optPseudoWindowLocation) {
    if (arguments.length < 3) {
      throw new Error('attachDocumentStub arity mismatch: ' + arguments.length);
    }
    if (!optPseudoWindowLocation) {
        optPseudoWindowLocation = {};
    }

    var domicile = {
      isProcessingEvent: false
    };
    var pluginId;

    makeDOMAccessible(pseudoBodyNode);
    var document = pseudoBodyNode.ownerDocument;
    makeDOMAccessible(document);
    makeDOMAccessible(document.documentElement);
    var bridal = bridalMaker(makeDOMAccessible, document);

    var window = bridalMaker.getWindow(pseudoBodyNode);
    makeDOMAccessible(window);
    
    var elementPolicies = {};
    elementPolicies.form = function (attribs) {
      // Forms must have a gated onsubmit handler or they must have an
      // external target.
      var sawHandler = false;
      for (var i = 0, n = attribs.length; i < n; i += 2) {
        if (attribs[+i] === 'onsubmit') {
          sawHandler = true;
        }
      }
      if (!sawHandler) {
        attribs.push('onsubmit', 'return false');
      }
      return attribs;
    };
    elementPolicies.a = elementPolicies.area = function (attribs) {
      // Anchor tags must always have the target '_blank'.
      attribs.push('target', '_blank');
      return attribs;
    };
    // TODO(kpreid): should elementPolicies be exported in domicile?

    // On IE, turn an <canvas> tags into canvas elements that explorercanvas
    // will recognize 
    bridal.initCanvasElements(pseudoBodyNode);

    // The private properties used in TameNodeConf are:
    //    feral (feral node)
    //    editable (this node editable)
    //    childrenEditable (this node editable)
    //    Several specifically for TameHTMLDocument.
    // Furthermore, by virtual of being scoped inside attachDocument,
    // TameNodeT also indicates that the object is a node from the *same*
    // virtual document.
    // TODO(kpreid): Review how necessary it is to scope this inside
    // attachDocument. The issues are:
    //   * Using authority or types from a different virtual document (check the
    //     things that used to be TameHTMLDocument.doc___ in particular)
    //   * Using nodes from a different real document (Domita would seem to be
    //     vulnerable to this?)
    var TameNodeConf = new Confidence('TameNode');
    var TameNodeT = TameNodeConf.guard;
    var np = TameNodeConf.p.bind(TameNodeConf);
    
    // A map from tame nodes to their expando proxies, used when only the tame
    // node is available and the proxy is needed to return to the client.
    var tamingProxies = new WeakMap();
    
    /**
     * Call this on every TameNode after it is constructed, and use its return
     * value instead of the node.
     *
     * TODO(kpreid): Is this the best way to handle things which need to be
     * done after the outermost constructor?
     */
    function finishNode(node) {
      if (domitaModules.proxiesAvailable) {
        // If running with proxies, it is indicative of something going wrong
        // if our objects are mutated (the expando proxy handler should
        // intercept writes). If running without proxies, then we need to be
        // unfrozen so that assignments to expando fields work.
        Object.freeze(node);
        
        // The proxy construction is deferred until now because the ES5/3
        // implementation of proxies requires that the proxy's prototype is
        // frozen.
        var proxiedNode = Proxy.create(np(node).proxyHandler, node);
        delete np(node).proxyHandler;  // no longer needed
        
        ExpandoProxyHandler.register(proxiedNode, node);
        TameNodeConf.confide(proxiedNode, node);
        tamingProxies.set(node, proxiedNode);
        rulebreaker.permitUntaming(proxiedNode);
        
        return proxiedNode;
      } else {
        return node;
      }
    }
    
    var nodeMethod = TameNodeConf.protectMethod;

    /** Sanitize HTML applying the appropriate transformations. */
    function sanitizeHtml(htmlText) {
      var out = [];
      htmlSanitizer(htmlText, out);
      return out.join('');
    }
    function sanitizeAttrs(tagName, attribs) {
      var n = attribs.length;
      for (var i = 0; i < n; i += 2) {
        var attribName = attribs[+i];
        var value = attribs[i + 1];
        var atype = null, attribKey;
        if ((attribKey = tagName + '::' + attribName,
             html4.ATTRIBS.hasOwnProperty(attribKey))
            || (attribKey = '*::' + attribName,
                html4.ATTRIBS.hasOwnProperty(attribKey))) {
          atype = html4.ATTRIBS[attribKey];
          value = rewriteAttribute(tagName, attribName, atype, value);
        } else {
          value = null;
        }
        if (value !== null && value !== void 0) {
          attribs[i + 1] = value;
        } else {
          // Swap last attribute name/value pair in place, and reprocess here.
          // This could affect how user-agents deal with duplicate attributes.
          attribs[i + 1] = attribs[--n];
          attribs[+i] = attribs[--n];
          i -= 2;
        }
      }
      attribs.length = n;
      var policy = elementPolicies[tagName];
      if (policy && elementPolicies.hasOwnProperty(tagName)) {
        return policy(attribs);
      }
      return attribs;
    }
    var htmlSanitizer = html.makeHtmlSanitizer(sanitizeAttrs);

    /**
     * If str ends with suffix,
     * and str is not identical to suffix,
     * then return the part of str before suffix.
     * Otherwise return fail.
     */
    function unsuffix(str, suffix, fail) {
      if (typeof str !== 'string') return fail;
      var n = str.length - suffix.length;
      if (0 < n && str.substring(n) === suffix) {
        return str.substring(0, n);
      } else {
        return fail;
      }
    }

    var ID_LIST_PARTS_PATTERN = new RegExp(
      '([^' + XML_SPACE + ']+)([' + XML_SPACE + ']+|$)', 'g');

    /** Convert a real attribute value to the value seen in a sandbox. */
    function virtualizeAttributeValue(attrType, realValue) {
      realValue = String(realValue);
      switch (attrType) {
        case html4.atype.GLOBAL_NAME:
        case html4.atype.ID:
        case html4.atype.IDREF:
          return unsuffix(realValue, idSuffix, null);
        case html4.atype.IDREFS:
          return realValue.replace(ID_LIST_PARTS_PATTERN,
              function(_, id, spaces) {
                return unsuffix(id, idSuffix, '') + (spaces ? ' ' : '');
              });
        case html4.atype.URI_FRAGMENT:
          if (realValue && '#' === realValue.charAt(0)) {
            realValue = unsuffix(realValue.substring(1), idSuffix, null);
            return realValue ? '#' + realValue : null;
          } else {
            return null;
          }
          break;
        default:
          return realValue;
      }
    }

    /**
     * Undoes some of the changes made by sanitizeHtml, e.g. stripping ID
     * prefixes.
     */
    function tameInnerHtml(htmlText) {
      var out = [];
      innerHtmlTamer(htmlText, out);
      return out.join('');
    }
    var innerHtmlTamer = html.makeSaxParser({
        startTag: function (tagName, attribs, out) {
          out.push('<', tagName);
          for (var i = 0; i < attribs.length; i += 2) {
            var aname = attribs[+i];
            var atype = getAttributeType(tagName, aname);
            var value = attribs[i + 1];
            if (aname !== 'target' && atype !== void 0) {
              value = virtualizeAttributeValue(atype, value);
              if (typeof value === 'string') {
                out.push(' ', aname, '="', html.escapeAttrib(value), '"');
              }
            }
          }
          out.push('>');
        },
        endTag: function (name, out) { out.push('</', name, '>'); },
        pcdata: function (text, out) { out.push(text); },
        rcdata: function (text, out) { out.push(text); },
        cdata: function (text, out) { out.push(text); }
      });

    /**
     * Returns a normalized attribute value, or null if the attribute should
     * be omitted.
     * <p>This function satisfies the attribute rewriter interface defined in
     * {@link html-sanitizer.js}.  As such, the parameters are keys into
     * data structures defined in {@link html4-defs.js}.
     *
     * @param {string} tagName a canonical tag name.
     * @param {string} attribName a canonical tag name.
     * @param type as defined in html4-defs.js.
     *
     * @return {string|null} null to indicate that the attribute should not
     *   be set.
     */
    function rewriteAttribute(tagName, attribName, type, value) {
      switch (type) {
        case html4.atype.NONE:
          return String(value);
        case html4.atype.CLASSES:
          // note, className is arbitrary CDATA.
          value = String(value);
          if (!FORBIDDEN_ID_LIST_PATTERN.test(value)) {
            return value;
          }
          return null;
        case html4.atype.GLOBAL_NAME:
        case html4.atype.ID:
        case html4.atype.IDREF:
          value = String(value);
          if (value && isValidId(value)) {
            return value + idSuffix;
          }
          return null;
        case html4.atype.IDREFS:
          value = String(value);
          if (value && isValidIdList(value)) {
            return value.replace(ID_LIST_PARTS_PATTERN,
                function(_, id, spaces) {
                  return id + idSuffix + (spaces ? ' ' : '');
                });
          }
          return null;
        case html4.atype.LOCAL_NAME:
          value = String(value);
          if (value && isValidId(value)) {
            return value;
          }
          return null;
        case html4.atype.SCRIPT:
          value = String(value);
          // Translate a handler that calls a simple function like
          //   return foo(this, event)

          // TODO(mikesamuel): integrate cajita compiler to allow arbitrary
          // cajita in event handlers.
          var match = value.match(SIMPLE_HANDLER_PATTERN);
          if (!match) { return null; }
          var doesReturn = match[1];
          var fnName = match[2];
          value = (doesReturn ? 'return ' : '') + 'plugin_dispatchEvent___('
              + 'this, event, ' + pluginId + ', "'
              + fnName + '");';
          if (attribName === 'onsubmit') {
            value = 'try { ' + value + ' } finally { return false; }';
          }
          return value;
        case html4.atype.URI:
          value = String(value);
          if (!uriCallback) { return null; }
          return uriCallback.rewrite(
              value,
              getUriEffect(tagName, attribName),
              getLoaderType(tagName, attribName),
              { "XML_ATTR": attribName}) || null;
        case html4.atype.URI_FRAGMENT:
          value = String(value);
          if (value.charAt(0) === '#' && isValidId(value.substring(1))) {
            return value + idSuffix;
          }
          return null;
        case html4.atype.STYLE:
          if ('function' !== typeof value) {
            return sanitizeStyleAttrValue(String(value));
          }
          var cssPropertiesAndValues = cssSealerUnsealerPair.unseal(value);
          if (!cssPropertiesAndValues) { return null; }

          var css = [];
          for (var i = 0; i < cssPropertiesAndValues.length; i += 2) {
            var propName = cssPropertiesAndValues[+i];
            var propValue = cssPropertiesAndValues[i + 1];
            // If the propertyName differs between DOM and CSS, there will
            // be a semicolon between the two.
            // E.g., 'background-color;backgroundColor'
            // See CssTemplate.toPropertyValueList.
            var semi = propName.indexOf(';');
            if (semi >= 0) { propName = propName.substring(0, semi); }
            css.push(propName + ' : ' + propValue);
          }
          return css.join(' ; ');
        // Frames are ambient, so disallow reference.
        case html4.atype.FRAME_TARGET:
        default:
          return null;
      }
    }
    
    // Property descriptors which are independent of any feral object.
    /**
     * Property descriptor which throws on access.
     */
    var P_UNIMPLEMENTED = {
      enumerable: true,
      get: cajaVM.def(function () {
        throw new Error('Not implemented');
      })
    };
    /**
     * Property descriptor for an unsettable constant attribute (like DOM
     * attributes such as nodeType).
     */
    function P_constant(value) {
      return { enumerable: true, value: value };
    }
    
    /**
     * Construct property descriptors suitable for taming objects which use the
     * specified confidence, such that confidence.p(obj).feral is the feral
     * object to forward to and confidence.p(obj).editable is an
     * editable/readonly flag.
     *
     * Lowercase properties are property descriptors; uppercase ones are
     * constructors for parameterized property descriptors.
     */
    function PropertyTaming(confidence) {
      var p = confidence.p;
      var method = confidence.protectMethod;
      
      return cajaVM.def({
        /**
         * Property descriptor for properties which have the value the feral
         * object does and are not assignable.
         */
        ro: {
          enumerable: true,
          extendedAccessors: true,
          get: method(function (prop) {
            return p(this).feral[prop];
          })
        },
        
        /**
         * Property descriptor for properties which have the value the feral
         * object does, and are assignable if the wrapper is editable.
         */
        rw: {
          enumerable: true,
          extendedAccessors: true,
          get: method(function (prop) {
            return p(this).feral[prop];
          }),
          set: method(function (value, prop) {
            if (!p(this).editable) { throw new Error(NOT_EDITABLE); }
            p(this).feral[prop] = value;
          })
        },
        
        /**
         * Property descriptor for properties which have the value the feral
         * object does, and are assignable (with a predicate restricting the
         * values which may be assigned) if the wrapper is editable.
         * TODO(kpreid): Use guards instead of predicates.
         */
        RWCond: function (predicate) {
          return {
            enumerable: true,
            extendedAccessors: true,
            get: method(function (prop) {
              return p(this).feral[prop];
            }),
            set: method(function (value, prop) {
              var privates = p(this);
              if (!privates.editable) { throw new Error(NOT_EDITABLE); }
              if (predicate(value)) {
                privates.feral[prop] = value;
              }
            })
          };
        },
        
        /**
         * Property descriptor for properties which have a different name than
         * what they map to (e.g. labelElement.htmlFor vs. <label for=...>).
         * This function changes the name the extended accessor property
         * descriptor 'desc' sees.
         */
        Rename: function (mapName, desc) {
          return {
            enumerable: true,
            extendedAccessors: true,
            get: method(function (prop) {
              return desc.get.call(this, mapName);
            }),
            set: method(function (value, prop) {
              return desc.set.call(this, value, mapName);
            })
          };
        },
        
        /**
         * Property descriptor for forwarded properties which have node values
         * which may be nodes that might be outside of the virtual document.
         */
        related: {
          enumerable: true,
          extendedAccessors: true,
          get: method(function (prop) {
            if (!('editable' in p(this))) {
              throw new Error("Internal error: related property tamer can only"
                  + " be applied to objects with an editable flag");
            }
            return tameRelatedNode(p(this).feral[prop],
                                   p(this).editable,
                                   defaultTameNode);
          })
        },
        
        /**
         * Property descriptor which maps to an attribute or property, is 
         * assignable, and has the value transformed in some way.
         * @param {boolean} useAttrGetter true if the getter should delegate to
         *     {@code this.getAttribute}.  That method is assumed to
         *     already be trusted though {@code toValue} is still called on the
         *     result.
         *     If false, then {@code toValue} is called on the result of
         *     accessing the name property on the underlying element, a possibly
         *     untrusted value.
         * @param {Function} toValue transforms the attribute or underlying
         *     property value retrieved according to the useAttrGetter flag
         *     above to the value of the defined property.
         * @param {boolean} useAttrSetter like useAttrGetter but for a setter.
         *     Switches between the name property on the underlying node
         *     (the false case) or using this's {@code setAttribute} method
         *     (the true case).
         * @param {Function} fromValue called on the input before it is passed
         *     through according to the flag above.  This receives untrusted
         *     values, and can do any vetting or transformation.  If
         *     {@code useAttrSetter} is true then it need not do much value
         *     vetting since the {@code setAttribute} method must do its own
         *     vetting.
         */
        filter: function (useAttrGetter, toValue, useAttrSetter, fromValue) {
          var desc = {
            enumerable: true,
            extendedAccessors: true,
            get: useAttrGetter
                ? method(function (name) {
                    return toValue.call(this, this.getAttribute(name));
                  })
                : method(function (name) {
                    return toValue.call(this, p(this).feral[name]);
                  })
          };
          if (fromValue) {
            desc.set = useAttrSetter
                ? method(function (value, name) {
                    this.setAttribute(name, fromValue.call(this, value));
                  })
                : method(function (value, name) {
                    if (!p(this).editable) { throw new Error(NOT_EDITABLE); }
                    p(this).feral[name] = fromValue.call(this, value);
                  });
          }
          return desc;
        },
        filterAttr: function(toValue, fromValue) {
          return NP.filter(true, toValue, true, fromValue);
        },
        filterProp: function(toValue, fromValue) {
          return NP.filter(false, toValue, false, fromValue);
        }
      });
    }
    cajaVM.def(PropertyTaming);  // and its prototype
    
    // TODO(kpreid): We have completely unrelated things called 'np' and 'NP'.
    var NP = new PropertyTaming(TameNodeConf);
    
    // Node-specific property accessors:
    /**
     * Property descriptor for forwarded properties which have node values and
     * are descendants of this node.
     */
    var NP_tameDescendant = {
      enumerable: true,
      extendedAccessors: true,
      get: nodeMethod(function (prop) {
        return defaultTameNode(np(this).feral[prop],
                               np(this).childrenEditable);
      })
    };
    
    var nodeExpandos = new WeakMap(true);
    /**
     * Return the object which stores expando properties for a given
     * host DOM node.
     */
    function getNodeExpandoStorage(node) {
      var s = nodeExpandos.get(node);
      if (s === undefined) {
        nodeExpandos.set(node, s = {});
      }
      return s;
    }
    
    var editableTameNodeCache = new WeakMap(true);
    var readOnlyTameNodeCache = new WeakMap(true);
    
    /**
     * returns a tame DOM node.
     * @param {Node} node
     * @param {boolean} editable
     * @see <a href="http://www.w3.org/TR/DOM-Level-2-HTML/html.html"
     *       >DOM Level 2</a>
     */
    function defaultTameNode(node, editable) {
      if (node === null || node === void 0) { return null; }
      makeDOMAccessible(node);
      // TODO(mikesamuel): make sure it really is a DOM node

      var cache = editable ? editableTameNodeCache : readOnlyTameNodeCache;
      var tamed = cache.get(node);
      if (tamed !== void 0) {
        return tamed;
      }
      switch (node.nodeType) {
        case 1:  // Element
          var tagName = node.tagName.toLowerCase();
          if (tamingClassesByElement.hasOwnProperty(tagName)) {
            // Known element with specialized taming class (e.g. <a> has an href
            // property). This is deliberately before the unsafe test; for
            // example, <script> has its own class even though it is unsafe.
            tamed = new (tamingClassesByElement[tagName])(node, editable);
          } else if (!html4.ELEMENTS.hasOwnProperty(tagName)
              || (html4.ELEMENTS[tagName] & html4.eflags.UNSAFE)) {
            // If an unrecognized or unsafe node, return a
            // placeholder that doesn't prevent tree navigation,
            // but that doesn't allow mutation or leak attribute
            // information.
            tamed = new TameOpaqueNode(node, editable);
          } else {
            tamed = new TameElement(node, editable, editable);
          }
          break;
        case 2:  // Attr
          // Cannot generically wrap since we must have access to the
          // owner element
          throw 'Internal: Attr nodes cannot be generically wrapped';
          break;
        case 3:  // Text
        case 4:  // CDATA Section Node
          tamed = new TameTextNode(node, editable);
          break;
        case 8:  // Comment
          tamed = new TameCommentNode(node, editable);
          break;
        case 11: // Document Fragment
          tamed = new TameBackedNode(node, editable, editable);
          break;
        default:
          tamed = new TameOpaqueNode(node, editable);
          break;
      }
      tamed = finishNode(tamed);
      
      if (node.nodeType === 1) {
        cache.set(node, tamed);
      }
      return tamed;
    }

    function tameRelatedNode(node, editable, tameNodeCtor) {
      if (node === null || node === void 0) { return null; }
      if (node === np(tameDocument).feralPseudoBodyNode) {
        if (np(tameDocument).editable && !editable) {
          // FIXME: return a non-editable version of body.
          throw new Error(NOT_EDITABLE);
        }
        return tameDocument.body;
      }

      makeDOMAccessible(node);

      // Catch errors because node might be from a different domain.
      try {
        var docElem = node.ownerDocument.documentElement;
        for (var ancestor = node; ancestor; ancestor = ancestor.parentNode) {
          if (idClassPattern.test(ancestor.className)) {
            return tameNodeCtor(node, editable);
          } else if (ancestor === docElem) {
            return null;
          }
        }
        return tameNodeCtor(node, editable);
      } catch (e) {}
      return null;
    }

    /**
     * Returns the length of a raw DOM Nodelist object, working around
     * NamedNodeMap bugs in IE, Opera, and Safari as discussed at
     * http://code.google.com/p/google-caja/issues/detail?id=935
     *
     * @param nodeList a DOM NodeList.
     *
     * @return the number of nodes in the NodeList.
     */
    function getNodeListLength(nodeList) {
      var limit = nodeList.length;
      if (limit !== +limit) { limit = 1/0; }
      return limit;
    }

    /**
     * Constructs a NodeList-like object.
     *
     * @param tamed a JavaScript array that will be populated and decorated
     *     with the DOM NodeList API. If it has existing elements they will
     *     precede the actual NodeList elements.
     * @param nodeList an array-like object supporting a "length" property
     *     and "[]" numeric indexing, or a raw DOM NodeList;
     * @param editable whether the tame nodes wrapped by this object
     *     should permit editing.
     * @param opt_tameNodeCtor a function for constructing tame nodes
     *     out of raw DOM nodes.
     */
    function mixinNodeList(tamed, nodeList, editable, opt_tameNodeCtor) {
      // TODO(kpreid): Under a true ES5 environment, node lists should be
      // proxies so that they preserve liveness of the original lists.
      // This should be controlled by an option.
      
      var limit = getNodeListLength(nodeList);
      if (limit > 0 && !opt_tameNodeCtor) {
        throw 'Internal: Nonempty mixinNodeList() without a tameNodeCtor';
      }

      for (var i = tamed.length, j = 0; j < limit && nodeList[+j]; ++i, ++j) {
        tamed[+i] = opt_tameNodeCtor(nodeList[+j], editable);
      }

      // Guard against accidental leakage of untamed nodes
      nodeList = null;

      tamed.item = cajaVM.def(function (k) {
        k &= 0x7fffffff;
        if (k !== k) { throw new Error(); }
        return tamed[+k] || null;
      });

      return tamed;
    }

    function tameNodeList(nodeList, editable, opt_tameNodeCtor, opt_extras) {
      makeDOMAccessible(nodeList);
      return Object.freeze(mixinNodeList(
          opt_extras || [], nodeList, editable, opt_tameNodeCtor));
    }

    function tameOptionsList(nodeList, editable, opt_tameNodeCtor) {
      makeDOMAccessible(nodeList);
      var nl = mixinNodeList([], nodeList, editable, opt_tameNodeCtor);
      nl.selectedIndex = +nodeList.selectedIndex;
      return Object.freeze(nl);
    }

    /**
     * Return a fake node list containing tamed nodes.
     * @param {Array.<TameNode>} array of tamed nodes.
     * @return an array that duck types to a node list.
     */
    function fakeNodeList(array) {
      array.item = cajaVM.def(function(i) { return array[+i]; });
      return Object.freeze(array);
    }

    /**
     * Constructs an HTMLCollection-like object which indexes its elements
     * based on their NAME attribute.
     *
     * @param tamed a JavaScript array that will be populated and decorated
     *     with the DOM HTMLCollection API.
     * @param nodeList an array-like object supporting a "length" property
     *     and "[]" numeric indexing.
     * @param editable whether the tame nodes wrapped by this object
     *     should permit editing.
     * @param opt_tameNodeCtor a function for constructing tame nodes
     *     out of raw DOM nodes.
     *
     * TODO(kpreid): Per
     * <http://www.w3.org/TR/DOM-Level-2-HTML/html.html#ID-75708506>
     * this should be looking up ids as well as names. (And not returning
     * nodelists, but is that for compatibility?)
     */
    function mixinHTMLCollection(tamed, nodeList, editable, opt_tameNodeCtor) {
      mixinNodeList(tamed, nodeList, editable, opt_tameNodeCtor);

      var tameNodesByName = {};
      var tameNode;

      for (var i = 0; i < tamed.length && (tameNode = tamed[+i]); ++i) {
        var name = tameNode.getAttribute('name');
        if (name && !(name.charAt(name.length - 1) === '_' || (name in tamed)
                     || name === String(name & 0x7fffffff))) {
          if (!tameNodesByName[name]) { tameNodesByName[name] = []; }
          tameNodesByName[name].push(tameNode);
        }
      }

      for (var name in tameNodesByName) {
        var tameNodes = tameNodesByName[name];
        if (tameNodes.length > 1) {
          tamed[name] = fakeNodeList(tameNodes);
        } else {
          tamed[name] = tameNodes[0];
        }
      }

      tamed.namedItem = cajaVM.def(function(name) {
        name = String(name);
        if (name.charAt(name.length - 1) === '_') {
          return null;
        }
        if (Object.prototype.hasOwnProperty.call(tamed, name)) {
          return cajaVM.passesGuard(TameNodeT, tamed[name])
              ? tamed[name] : tamed[name][0];
        }
        return null;
      });

      return tamed;
    }

    function tameHTMLCollection(nodeList, editable, opt_tameNodeCtor) {
      return Object.freeze(
          mixinHTMLCollection([], nodeList, editable, opt_tameNodeCtor));
    }

    function tameGetElementsByTagName(rootNode, tagName, editable, extras) {
      tagName = String(tagName);
      if (tagName !== '*') {
        tagName = tagName.toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(html4.ELEMENTS, tagName)
            || html4.ELEMENTS[tagName] & html4.ELEMENTS.UNSAFE) {
          // Allowing getElementsByTagName to work for opaque element types
          // would leak information about those elements.
          return new fakeNodeList([]);
        }
      }
      return tameNodeList(rootNode.getElementsByTagName(tagName), editable,
                          defaultTameNode, extras);
    }

    /**
     * Implements http://www.whatwg.org/specs/web-apps/current-work/#dom-document-getelementsbyclassname
     * using an existing implementation on browsers that have one.
     */
    function tameGetElementsByClassName(rootNode, className, editable) {
      className = String(className);

      // The quotes below are taken from the HTML5 draft referenced above.

      // "having obtained the classes by splitting a string on spaces"
      // Instead of using split, we use match with the global modifier so that
      // we don't have to remove leading and trailing spaces.
      var classes = className.match(/[^\t\n\f\r ]+/g);

      // Filter out classnames in the restricted namespace.
      for (var i = classes ? classes.length : 0; --i >= 0;) {
        var classi = classes[+i];
        if (FORBIDDEN_ID_PATTERN.test(classi)) {
          classes[+i] = classes[classes.length - 1];
          --classes.length;
        }
      }

      if (!classes || classes.length === 0) {
        // "If there are no tokens specified in the argument, then the method
        //  must return an empty NodeList" [instead of all elements]
        // This means that
        //     htmlEl.ownerDocument.getElementsByClassName(htmlEl.className)
        // will return an HtmlCollection containing htmlElement iff
        // htmlEl.className contains a non-space character.
        return fakeNodeList([]);
      }

      // "unordered set of unique space-separated tokens representing classes"
      if (typeof rootNode.getElementsByClassName === 'function') {
        return tameNodeList(
            rootNode.getElementsByClassName(
                classes.join(' ')), editable, defaultTameNode);
      } else {
        // Add spaces around each class so that we can use indexOf later to find
        // a match.
        // This use of indexOf is strictly incorrect since
        // http://www.whatwg.org/specs/web-apps/current-work/#reflecting-content-attributes-in-dom-attributes
        // does not normalize spaces in unordered sets of unique space-separated
        // tokens.  This is not a problem since HTML5 compliant implementations
        // already have a getElementsByClassName implementation, and legacy
        // implementations do normalize according to comments on issue 935.

        // We assume standards mode, so the HTML5 requirement that
        //   "If the document is in quirks mode, then the comparisons for the
        //    classes must be done in an ASCII case-insensitive  manner,"
        // is not operative.
        var nClasses = classes.length;
        for (var i = nClasses; --i >= 0;) {
          classes[+i] = ' ' + classes[+i] + ' ';
        }

        // We comply with the requirement that the result is a list
        //   "containing all the elements in the document, in tree order,"
        // since the spec for getElementsByTagName has the same language.
        var candidates = rootNode.getElementsByTagName('*');
        var matches = [];
        var limit = candidates.length;
        if (limit !== +limit) { limit = 1/0; }  // See issue 935
        candidate_loop:
        for (var j = 0, candidate, k = -1;
             j < limit && (candidate = candidates[+j]);
             ++j) {
          var candidateClass = ' ' + candidate.className + ' ';
          for (var i = nClasses; --i >= 0;) {
            if (-1 === candidateClass.indexOf(classes[+i])) {
              continue candidate_loop;
            }
          }
          var tamed = defaultTameNode(candidate, editable);
          if (tamed) {
            matches[++k] = tamed;
          }
        }
        // "the method must return a live NodeList object"
        return fakeNodeList(matches);
      }
    }

    function makeEventHandlerWrapper(thisNode, listener) {
      domitaModules.ensureValidCallback(listener);
      function wrapper(event) {
        return plugin_dispatchEvent(
            thisNode, event, rulebreaker.getId(tameWindow), listener);
      }
      return wrapper;
    }

    var NOT_EDITABLE = "Node not editable.";
    var UNSAFE_TAGNAME = "Unsafe tag name.";
    var UNKNOWN_TAGNAME = "Unknown tag name.";
    var INDEX_SIZE_ERROR = "Index size error.";

    // Implementation of EventTarget::addEventListener
    function tameAddEventListener(name, listener, useCapture) {
      var feral = np(this).feral;
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      if (!np(this).wrappedListeners) { np(this).wrappedListeners = []; }
      useCapture = Boolean(useCapture);
      var wrappedListener = makeEventHandlerWrapper(np(this).feral, listener);
      wrappedListener = bridal.addEventListener(
          np(this).feral, name, wrappedListener, useCapture);
      wrappedListener._d_originalListener = listener;
      np(this).wrappedListeners.push(wrappedListener);
    }

    // Implementation of EventTarget::removeEventListener
    function tameRemoveEventListener(name, listener, useCapture) {
      var self = TameNodeT.coerce(this);
      var feral = np(self).feral;
      if (!np(self).editable) { throw new Error(NOT_EDITABLE); }
      if (!np(this).wrappedListeners) { return; }
      var wrappedListener = null;
      for (var i = np(this).wrappedListeners.length; --i >= 0;) {
        if (np(this).wrappedListeners[+i]._d_originalListener === listener) {
          wrappedListener = np(this).wrappedListeners[+i];
          arrayRemove(np(this).wrappedListeners, i, i);
          break;
        }
      }
      if (!wrappedListener) { return; }
      bridal.removeEventListener(
          np(this).feral, name, wrappedListener, useCapture);
    }

    // A map of tamed node classes, keyed by DOM Level 2 standard name, which
    // will be exposed to the client.
    var nodeClasses = {};
    
    // A map of tamed node constructors, keyed by HTML element name, which will
    // be used by defaultTameNode.
    var tamingClassesByElement = {};

    /**
     * This does three things:
     * 
     * Replace tamedCtor's prototype with one whose prototype is someSuper.
     * 
     * Hide the constructor of the products of tamedCtor, replacing it with a
     * function which just throws (but can still be used for instanceof checks).
     * 
     * Register the inert ctor under the given name if specified.
     */
    function inertCtor(tamedCtor, someSuper, opt_name) {
      inherit(tamedCtor, someSuper);
      
      var inert = function() {
        throw new TypeError('This constructor cannot be called directly.');
      };
      inert.prototype = tamedCtor.prototype;
      Object.freeze(inert);  // not def, because inert.prototype must remain
      setOwn(tamedCtor.prototype, "constructor", inert);
      
      if (opt_name !== undefined)
        nodeClasses[opt_name] = inert;
      
      return inert;
    }

    traceStartup("DT: about to make TameNode");
    
    /**
     * Base class for a Node wrapper.  Do not create directly -- use the
     * tameNode factory instead.
     *
     * NOTE that all TameNodes should have the TameNodeT trademark, but it is
     * not applied here since that freezes the object, and also because of the
     * forwarding proxies used for catching expando properties.
     *
     * @param {boolean} editable true if the node's value, attributes, children,
     *     or custom properties are mutable.
     * @constructor
     */
    function TameNode(editable) {
      TameNodeConf.confide(this);
      np(this).editable = editable;
      rulebreaker.permitUntaming(this);  // needed for testing
      return this;
    }
    inertCtor(TameNode, Object, 'Node');
    traceStartup("DT: about to DPA TameNode");
    definePropertiesAwesomely(TameNode.prototype, {
      // tameDocument is not yet defined at this point so can't be a constant
      ownerDocument: {
        enumerable: canHaveEnumerableAccessors,
        get: cajaVM.def(function () {
        return tameDocument;
      }) }
    });
    traceStartup("DT: about to set toString for TameNode");
    /**
     * Print this object according to its tamed class name; also note for
     * debugging purposes if it is actually the prototype instance.
     */
    setOwn(TameNode.prototype, "toString", cajaVM.def(function (opt_self) {
      // recursion exit case
      if (this === Object.prototype || this == null || this == undefined) {
        return Object.prototype.toString.call(opt_self || this);
      }
      
      var ctor = this.constructor;
      for (var name in nodeClasses) { // TODO(kpreid): less O(n)
        if (nodeClasses[name] === ctor) {
          if (ctor.prototype === (opt_self || this)) {
            return "[domado PROTOTYPE OF " + name + "]";
          } else {
            return "[domado object " + name + "]";
          }
        }
      }
      
      // try again with our prototype, passing the real this in
      return TameNode.prototype.toString.call(
          Object.getPrototypeOf(this), this);
    }));
    // abstract TameNode.prototype.nodeType
    // abstract TameNode.prototype.nodeName
    // abstract TameNode.prototype.nodeValue
    // abstract TameNode.prototype.cloneNode
    // abstract TameNode.prototype.appendChild
    // abstract TameNode.prototype.insertBefore
    // abstract TameNode.prototype.removeChild
    // abstract TameNode.prototype.replaceChild
    // abstract TameNode.prototype.firstChild
    // abstract TameNode.prototype.lastChild
    // abstract TameNode.prototype.nextSibling
    // abstract TameNode.prototype.previousSibling
    // abstract TameNode.prototype.parentNode
    // abstract TameNode.prototype.getElementsByTagName
    // abstract TameNode.prototype.getElementsByClassName
    // abstract TameNode.prototype.childNodes
    // abstract TameNode.prototype.attributes
    var tameNodePublicMembers = [
        'cloneNode',
        'appendChild', 'insertBefore', 'removeChild', 'replaceChild',
        'getElementsByClassName', 'getElementsByTagName', 'dispatchEvent',
        'hasChildNodes'
        ];
    traceStartup("DT: about to defend TameNode");
    cajaVM.def(TameNode);  // and its prototype

    traceStartup("DT: about to make TameBackedNode");

    /**
     * A tame node that is backed by a real node.
     * 
     * Note that the constructor returns a proxy which delegates to 'this';
     * subclasses should apply properties to 'this' but return the proxy.
     * 
     * @param {boolean} childrenEditable true iff the child list is mutable.
     * @param {Function} opt_proxyType The constructor of the proxy handler
     *     to use, defaulting to ExpandoProxyHandler.
     * @constructor
     */
    function TameBackedNode(node, editable, childrenEditable, opt_proxyType) {
      makeDOMAccessible(node);
      
      if (!node) {
        throw new Error('Creating tame node with undefined native delegate');
      }

      TameNode.call(this, editable);
      
      np(this).feral = node;
      np(this).childrenEditable = editable && childrenEditable;

      if (domitaModules.proxiesAvailable) {
        np(this).proxyHandler = new (opt_proxyType || ExpandoProxyHandler)(
            this, editable, getNodeExpandoStorage(node));
      }
    }
    inertCtor(TameBackedNode, TameNode);
    definePropertiesAwesomely(TameBackedNode.prototype, {
      nodeType: NP.ro,
      nodeName: NP.ro,
      nodeValue: NP.ro,
      firstChild: NP_tameDescendant,
      lastChild: NP_tameDescendant,
      nextSibling: NP.related,
      previousSibling: NP.related,
      parentNode: NP.related,
      childNodes: {
        enumerable: true,
        get: cajaVM.def(function () {
          return tameNodeList(np(this).feral.childNodes,
                              np(this).childrenEditable, defaultTameNode);
        })
      },
      attributes: {
        enumerable: true,
        get: cajaVM.def(function () {
          var thisNode = np(this).feral;
          var tameNodeCtor = function(node, editable) {
            return new TameBackedAttributeNode(node, editable, thisNode);
          };
          return tameNodeList(
              thisNode.attributes, thisNode, tameNodeCtor);
        })
      }
    });
    TameBackedNode.prototype.cloneNode = nodeMethod(function (deep) {
      var clone = bridal.cloneNode(np(this).feral, Boolean(deep));
      // From http://www.w3.org/TR/DOM-Level-2-Core/core.html#ID-3A0ED0A4
      //     "Note that cloning an immutable subtree results in a mutable copy"
      return defaultTameNode(clone, true);
    });
    TameBackedNode.prototype.appendChild = nodeMethod(function (child) {
      // Child must be editable since appendChild can remove it from its parent.
      child = TameNodeT.coerce(child);
      if (!np(this).childrenEditable || !np(child).editable) {
        throw new Error(NOT_EDITABLE);
      }
      np(this).feral.appendChild(np(child).feral);
      return child;
    });
    TameBackedNode.prototype.insertBefore = nodeMethod(
        function(toInsert, child) {
      toInsert = TameNodeT.coerce(toInsert);
      if (child === void 0) { child = null; }
      if (child !== null) {
        child = TameNodeT.coerce(child);
        if (!np(child).editable) {
          throw new Error(NOT_EDITABLE);
        }
      }
      if (!np(this).childrenEditable || !np(toInsert).editable) {
        throw new Error(NOT_EDITABLE);
      }
      np(this).feral.insertBefore(
          np(toInsert).feral, child !== null ? np(child).feral : null);
      return toInsert;
    });
    TameBackedNode.prototype.removeChild = nodeMethod(function(child) {
      child = TameNodeT.coerce(child);
      if (!np(this).childrenEditable || !np(child).editable) {
        throw new Error(NOT_EDITABLE);
      }
      np(this).feral.removeChild(np(child).feral);
      return child;
    });
    TameBackedNode.prototype.replaceChild = nodeMethod(
        function(newChild, oldChild) {
      newChild = TameNodeT.coerce(newChild);
      oldChild = TameNodeT.coerce(oldChild);
      if (!np(this).childrenEditable || !np(newChild).editable
          || !np(oldChild).editable) {
        throw new Error(NOT_EDITABLE);
      }
      np(this).feral.replaceChild(np(newChild).feral, np(oldChild).feral);
      return oldChild;
    });
    TameBackedNode.prototype.getElementsByTagName = nodeMethod(
        function(tagName) {
      return tameGetElementsByTagName(
          np(this).feral, tagName, np(this).childrenEditable, []);
    });
    TameBackedNode.prototype.getElementsByClassName = nodeMethod(
        function(className) {
      return tameGetElementsByClassName(
          np(this).feral, className, np(this).childrenEditable);
    });
    TameBackedNode.prototype.hasChildNodes = nodeMethod(function() {
      return !!np(this).feral.hasChildNodes();
    });
    // http://www.w3.org/TR/DOM-Level-2-Events/events.html#Events-EventTarget :
    // "The EventTarget interface is implemented by all Nodes"
    TameBackedNode.prototype.dispatchEvent = nodeMethod(function(evt) {
      evt = TameEventT.coerce(evt);
      bridal.dispatchEvent(np(this).feral, TameEventConf.p(evt).feral);
    });
    if (document.documentElement.contains) {  // typeof is 'object' on IE
      TameBackedNode.prototype.contains = nodeMethod(function (other) {
        other = TameNodeT.coerce(other);
        var otherNode = np(other).feral;
        return np(this).feral.contains(otherNode);
      });
    }
    if ('function' ===
        typeof document.documentElement.compareDocumentPosition) {
      /**
       * Speced in <a href="http://www.w3.org/TR/DOM-Level-3-Core/core.html#Node3-compareDocumentPosition">DOM-Level-3</a>.
       */
      TameBackedNode.prototype.compareDocumentPosition = nodeMethod(
          function (other) {
        other = TameNodeT.coerce(other);
        var otherNode = np(other).feral;
        if (!otherNode) { return 0; }
        var bitmask = +np(this).feral.compareDocumentPosition(otherNode);
        // To avoid leaking information about the relative positioning of
        // different roots, if neither contains the other, then we mask out
        // the preceding/following bits.
        // 0x18 is (CONTAINS | CONTAINED)
        // 0x1f is all the bits documented at
        //     http://www.w3.org/TR/DOM-Level-3-Core/core.html#DocumentPosition
        //     except IMPLEMENTATION_SPECIFIC
        // 0x01 is DISCONNECTED
        /*
        if (!(bitmask & 0x18)) {
          // TODO: If they are not under the same virtual doc root, return
          // DOCUMENT_POSITION_DISCONNECTED instead of leaking information
          // about PRECEDING | FOLLOWING.
        }
        */
        // Firefox3 returns spurious PRECEDING and FOLLOWING bits for
        // disconnected trees.
        // https://bugzilla.mozilla.org/show_bug.cgi?id=486002
        if (bitmask & 1) {
          bitmask &= ~6;
        }
        return bitmask & 0x1f;
      });
      if (!Object.prototype.hasOwnProperty.call(TameBackedNode.prototype,
          'contains')) {
        // http://www.quirksmode.org/blog/archives/2006/01/contains_for_mo.html
        TameBackedNode.prototype.contains = nodeMethod(function (other) {
          var docPos = this.compareDocumentPosition(other);
          return !(!(docPos & 0x10) && docPos);
        });
      }
    }
    cajaVM.def(TameBackedNode);  // and its prototype

    traceStartup("DT: about to make TamePseudoNode");
    
    /**
     * A fake node that is not backed by a real DOM node.
     * @constructor
     */
    function TamePseudoNode(editable) {
      TameNode.call(this, editable);

      if (domitaModules.proxiesAvailable) {
        // finishNode will wrap 'this' with an actual proxy later.
        np(this).proxyHandler = new ExpandoProxyHandler(this, editable, {});
      }
    }
    inertCtor(TamePseudoNode, TameNode);
    TamePseudoNode.prototype.appendChild =
    TamePseudoNode.prototype.insertBefore =
    TamePseudoNode.prototype.removeChild =
    TamePseudoNode.prototype.replaceChild = nodeMethod(function () {
      if (typeof console !== 'undefined') {
        console.log("Node not editable; no action performed.");
      }
      return void 0;
    });
    TamePseudoNode.prototype.hasChildNodes = nodeMethod(function () {
      return this.firstChild != null;
    });
    definePropertiesAwesomely(TamePseudoNode.prototype, {
      firstChild: { enumerable: true, get: nodeMethod(function () {
        var children = this.childNodes;
        return children.length ? children[0] : null;
      })},
      lastChild: { enumerable: true, get: nodeMethod(function () {
        var children = this.childNodes;
        return children.length ? children[children.length - 1] : null;
      })},
      nextSibling: { enumerable: true, get: nodeMethod(function () {
        var self = tamingProxies.get(this) || this;
        var parentNode = this.parentNode;
        if (!parentNode) { return null; }
        var siblings = parentNode.childNodes;
        for (var i = siblings.length - 1; --i >= 0;) {
          if (siblings[+i] === self) { return siblings[i + 1]; }
        }
        return null;
      })},
      previousSibling: { enumerable: true, get: nodeMethod(function () {
        var self = tamingProxies.get(this) || this;
        var parentNode = this.parentNode;
        if (!parentNode) { return null; }
        var siblings = parentNode.childNodes;
        for (var i = siblings.length; --i >= 1;) {
          if (siblings[+i] === self) { return siblings[i - 1]; }
        }
        return null;
      })}
    });
    cajaVM.def(TamePseudoNode);  // and its prototype

    traceStartup("DT: done fundamental nodes");
    
    var commonElementPropertyHandlers = (function() {
      var geometryDelegateProperty = {
        extendedAccessors: true,
        enumerable: true,
        get: nodeMethod(function (prop) {
          return np(this).geometryDelegate[prop];
        })
      };
      var geometryDelegatePropertySettable =
          Object.create(geometryDelegateProperty);
      geometryDelegatePropertySettable.set = nodeMethod(function (value, prop) {
        if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
        np(this).geometryDelegate.scrollTop = +value;
      });
      return {
        clientWidth: geometryDelegateProperty,
        clientHeight: geometryDelegateProperty,
        offsetLeft: geometryDelegateProperty,
        offsetTop: geometryDelegateProperty,
        offsetWidth: geometryDelegateProperty,
        offsetHeight: geometryDelegateProperty,
        scrollLeft: geometryDelegatePropertySettable,
        scrollTop: geometryDelegatePropertySettable,
        scrollWidth: geometryDelegateProperty,
        scrollHeight: geometryDelegateProperty
      };
    })();

    function TamePseudoElement(
        tagName, tameDoc, childNodesGetter, parentNodeGetter, innerHTMLGetter,
        geometryDelegate, editable) {
      TamePseudoNode.call(this, editable);
      
      definePropertiesAwesomely(this, {
        nodeName: P_constant(tagName),
        tagName: P_constant(tagName),
        ownerDocument: P_constant(tameDoc),
        childNodes: { enumerable: true, get: nodeMethod(childNodesGetter) },
        attributes: { enumerable: true, get: nodeMethod(function () {
          return tameNodeList([], false, undefined);
        })},
        parentNode: { enumerable: true, get: nodeMethod(parentNodeGetter) },
        innerHTML: { enumerable: true, get: nodeMethod(innerHTMLGetter) }
      });
      
      np(this).geometryDelegate = geometryDelegate;
    }
    inertCtor(TamePseudoElement, TamePseudoNode);
    // TODO(mikesamuel): make nodeClasses work.
    TamePseudoElement.prototype.getAttribute
        = nodeMethod(function (attribName) { return null; });
    TamePseudoElement.prototype.setAttribute
        = nodeMethod(function (attribName, value) { });
    TamePseudoElement.prototype.hasAttribute
        = nodeMethod(function (attribName) { return false; });
    TamePseudoElement.prototype.removeAttribute
        = nodeMethod(function (attribName) { });
    TamePseudoElement.prototype.getElementsByTagName = nodeMethod(
        function (tagName) {
      tagName = String(tagName).toLowerCase();
      if (tagName === this.tagName) {
        // Works since html, head, body, and title can't contain themselves.
        return fakeNodeList([]);
      }
      return this.ownerDocument.getElementsByTagName(tagName);
    });
    TamePseudoElement.prototype.getElementsByClassName = nodeMethod(
        function (className) {
      return this.ownerDocument.getElementsByClassName(className);
    });
    TamePseudoElement.prototype.getBoundingClientRect = nodeMethod(function () {
      return np(this).geometryDelegate.getBoundingClientRect();
    });
    definePropertiesAwesomely(TamePseudoElement.prototype,
        commonElementPropertyHandlers);
    definePropertiesAwesomely(TamePseudoElement.prototype, {
      nodeType: P_constant(1),
      nodeValue: P_constant(null)
    });
    cajaVM.def(TamePseudoElement);  // and its prototype
    
    traceStartup("DT: got to TameOpaqueNode");
    
    function TameOpaqueNode(node, editable) {
      TameBackedNode.call(this, node, editable, editable);
    }
    inherit(TameOpaqueNode, TameBackedNode);
    traceStartup("DT: nonopaqueification starting");
    for (var safe in {
      nodeValue: 0,
      nodeType: 0,
      nodeName: 0,
      nextSibling: 0,
      previousSibling: 0,
      firstChild: 0,
      lastChild: 0,
      parentNode: 0,
      childNodes: 0,
      ownerDocument: 0,
      getElementsByTagName: 0,
      getElementsByClassName: 0,
      hasChildNodes: 0
    }) {
      // Any non-own property is overridden to be opaque below.
      Object.defineProperty(
        TameOpaqueNode.prototype,
        safe,
        domitaModules.getPropertyDescriptor(TameBackedNode.prototype, safe));
    }
    traceStartup("DT: nonopaqueification done");
    definePropertiesAwesomely(TameOpaqueNode.prototype, {
      attributes: {
        enumerable: canHaveEnumerableAccessors,
        get: nodeMethod(function () {
          return tameNodeList([], false, undefined);
        })
      }
    });
    function throwOpaque() {
      throw new Error('Node is opaque');
    }
    cajaVM.def(throwOpaque);
    for (var i = tameNodePublicMembers.length; --i >= 0;) {
      var k = tameNodePublicMembers[+i];
      if (!TameOpaqueNode.prototype.hasOwnProperty(k)) {
        if (typeof TameBackedNode.prototype[k] === 'Function') {
          TameOpaqueNode.prototype[k] = throwOpaque;
        } else {
          Object.defineProperty(TameOpaqueNode.prototype, k, {
            enumerable: canHaveEnumerableAccessors,
            get: throwOpaque
          });
        }
      }
    }
    cajaVM.def(TameOpaqueNode);  // and its prototype

    traceStartup("DT: about to make TameTextNode");
    
    function TameTextNode(node, editable) {
      assert(node.nodeType === 3);

      // The below should not be strictly necessary since childrenEditable for
      // TameScriptElements is always false, but it protects against tameNode
      // being called naively on a text node from container code.
      var pn = node.parentNode;
      if (editable && pn) {
        if (1 === pn.nodeType
            && (html4.ELEMENTS[pn.tagName.toLowerCase()]
                & html4.eflags.UNSAFE)) {
          // Do not allow mutation of text inside script elements.
          // See the testScriptLoading testcase for examples of exploits.
          editable = false;
        }
      }

      TameBackedNode.call(this, node, editable, editable);
    }
    inertCtor(TameTextNode, TameBackedNode, 'Text');
    var textAccessor = {
      enumerable: true,
      get: nodeMethod(function () {
        return np(this).feral.nodeValue;
      }),
      set: nodeMethod(function (value) {
        if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
        np(this).feral.nodeValue = String(value || '');
      })
    };
    definePropertiesAwesomely(TameTextNode.prototype, {
      nodeValue: textAccessor,
      textContent: textAccessor,
      innerText: textAccessor,
      data: textAccessor
    });
    setOwn(TameTextNode.prototype, "toString", nodeMethod(function () {
      return '#text';
    }));
    cajaVM.def(TameTextNode);  // and its prototype

    function TameCommentNode(node, editable) {
      assert(node.nodeType === 8);
      TameBackedNode.call(this, node, editable, editable);
    }
    inertCtor(TameCommentNode, TameBackedNode, 'CommentNode');
    setOwn(TameCommentNode.prototype, "toString", nodeMethod(function () {
      return '#comment';
    }));
    cajaVM.def(TameCommentNode);  // and its prototype

    function lookupAttribute(map, tagName, attribName) {
      var attribKey;
      attribKey = tagName + '::' + attribName;
      if (map.hasOwnProperty(attribKey)) {
        return map[attribKey];
      }
      attribKey = '*::' + attribName;
      if (map.hasOwnProperty(attribKey)) {
        return map[attribKey];
      }
      return void 0;
    }
    function getAttributeType(tagName, attribName) {
      return lookupAttribute(html4.ATTRIBS, tagName, attribName);
    }
    function getLoaderType(tagName, attribName) {
      return lookupAttribute(html4.LOADERTYPES, tagName, attribName);
    }
    function getUriEffect(tagName, attribName) {
      return lookupAttribute(html4.URIEFFECTS, tagName, attribName);
    }

    traceStartup("DT: about to make TameBackedAttributeNode");
    /**
     * Plays the role of an Attr node for TameElement objects.
     */
    function TameBackedAttributeNode(node, editable, ownerElement) {
      if (ownerElement === undefined) throw new Error("ownerElement undefined");
      TameBackedNode.call(this, node, editable);
      np(this).ownerElement = ownerElement;
    }
    inertCtor(TameBackedAttributeNode, TameBackedNode, 'Attr');
    setOwn(TameBackedAttributeNode.prototype, 'cloneNode',
        nodeMethod(function (deep) {
      var clone = bridal.cloneNode(np(this).feral, Boolean(deep));
      // From http://www.w3.org/TR/DOM-Level-2-Core/core.html#ID-3A0ED0A4
      //     "Note that cloning an immutable subtree results in a mutable copy"
      return new TameBackedAttributeNode(clone, true, np(this).ownerElement);
    }));
    var valueAccessor = {
      enumerable: true,
      get: nodeMethod(function () {
         return this.ownerElement.getAttribute(this.name);
      }),
      set: nodeMethod(function (value) {
        return this.ownerElement.setAttribute(this.name, value);
      })
    };
    definePropertiesAwesomely(TameBackedAttributeNode.prototype, {
      nodeName: NP.Rename("name", NP.ro),
      name: NP.ro,
      specified: {
        enumerable: true,
        get: nodeMethod(function () {
          return this.ownerElement.hasAttribute(this.name);
        })
      },
      nodeValue: valueAccessor,
      value: valueAccessor,
      ownerElement: {
        enumerable: true,
        get: nodeMethod(function () {
          return defaultTameNode(np(this).ownerElement, np(this).editable);
        })
      },
      nodeType: P_constant(2),
      firstChild:      P_UNIMPLEMENTED,
      lastChild:       P_UNIMPLEMENTED,
      nextSibling:     P_UNIMPLEMENTED,
      previousSibling: P_UNIMPLEMENTED,
      parentNode:      P_UNIMPLEMENTED,
      childNodes:      P_UNIMPLEMENTED,
      attributes:      P_UNIMPLEMENTED
    });
    var notImplementedNodeMethod = {
      enumerable: true,
      value: nodeMethod(function () {
        throw new Error('Not implemented.');
      })
    };
    ['appendChild', 'insertBefore', 'removeChild', 'replaceChild',
     'getElementsByTagName', 'getElementsByClassName'].forEach(function (m) {
      Object.defineProperty(
        TameBackedAttributeNode.prototype, m, notImplementedNodeMethod);
    });
    cajaVM.def(TameBackedAttributeNode);  // and its prototype
    traceStartup("DT: after TameBackedAttributeNode");

    // Register set handlers for onclick, onmouseover, etc.
    function registerElementScriptAttributeHandlers(tameElementPrototype) {
      var seenAlready = {};
      var attrNameRe = /::(.*)/;
      for (var html4Attrib in html4.ATTRIBS) {
        if (html4.atype.SCRIPT === html4.ATTRIBS[html4Attrib]) {
          (function (attribName) {
            // Attribute names are defined per-element, so we will see
            // duplicates here.
            if (Object.prototype.hasOwnProperty.call(seenAlready, attribName)) {
              return;
            }
            seenAlready[attribName] = true;
            
            Object.defineProperty(tameElementPrototype, attribName, {
              enumerable: canHaveEnumerableAccessors,
              configurable: false,
              set: nodeMethod(function eventHandlerSetter(listener) {
                if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
                if (!listener) {  // Clear the current handler
                  np(this).feral[attribName] = null;
                } else {
                  // This handler cannot be copied from one node to another
                  // which is why getters are not yet supported.
                  np(this).feral[attribName] = makeEventHandlerWrapper(
                      np(this).feral, listener);
                }
                return listener;
              })
            });
          })(html4Attrib.match(attrNameRe)[1]);
        }
      }
    }

    traceStartup("DT: about to make TameElement");
    /**
     * See comments on TameBackedNode regarding return value.
     * @constructor
     */
    function TameElement(node, editable, childrenEditable, opt_proxyType) {
      assert(node.nodeType === 1);
      var obj = TameBackedNode.call(this, node, editable, childrenEditable,
         opt_proxyType);
      np(this).geometryDelegate = node;
      return obj;
    }
    nodeClasses.Element = inertCtor(TameElement, TameBackedNode, 'HTMLElement');
    registerElementScriptAttributeHandlers(TameElement.prototype);
    TameElement.prototype.blur = nodeMethod(function () {
      np(this).feral.blur();
    });
    TameElement.prototype.focus = nodeMethod(function () {
      if (domicile.isProcessingEvent) {
        np(this).feral.focus();
      }
    });
    // IE-specific method.  Sets the element that will have focus when the
    // window has focus, without focusing the window.
    if (document.documentElement.setActive) {
      TameElement.prototype.setActive = nodeMethod(function () {
        if (domicile.isProcessingEvent) {
          np(this).feral.setActive();
        }
      });
    }
    // IE-specific method.
    if (document.documentElement.hasFocus) {
      TameElement.prototype.hasFocus = nodeMethod(function () {
        return np(this).feral.hasFocus();
      });
    }
    TameElement.prototype.getAttribute = nodeMethod(function (attribName) {
      var feral = np(this).feral;
      attribName = String(attribName).toLowerCase();
      var tagName = feral.tagName.toLowerCase();
      var atype = getAttributeType(tagName, attribName);
      if (atype === void 0) {
        // Unrecognized attribute; use virtual map
        if (feral._d_attributes) {
          return feral._d_attributes[attribName] || null;
        }
        return null;
      }
      var value = bridal.getAttribute(feral, attribName);
      if ('string' !== typeof value) { return value; }
      return virtualizeAttributeValue(atype, value);
    });
    TameElement.prototype.getAttributeNode = nodeMethod(function (name) {
      var feral = np(this).feral;
      var hostDomNode = feral.getAttributeNode(name);
      if (hostDomNode === null) { return null; }
      return new TameBackedAttributeNode(
          hostDomNode, np(this).editable, feral);
    });
    TameElement.prototype.hasAttribute = nodeMethod(function (attribName) {
      var feral = np(this).feral;
      attribName = String(attribName).toLowerCase();
      var tagName = feral.tagName.toLowerCase();
      var atype = getAttributeType(tagName, attribName);
      if (atype === void 0) {
        // Unrecognized attribute; use virtual map
        return !!(
            feral._d_attributes &&
            Object.prototype.hasOwnProperty.call(
                feral._d_attributes, attribName));
      } else {
        return bridal.hasAttribute(feral, attribName);
      }
    });
    TameElement.prototype.setAttribute = nodeMethod(
        function (attribName, value) {
      //console.debug("setAttribute", this, attribName, value);
      var feral = np(this).feral;
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      attribName = String(attribName).toLowerCase();
      var tagName = feral.tagName.toLowerCase();
      var atype = getAttributeType(tagName, attribName);
      if (atype === void 0) {
        // Unrecognized attribute; use virtual map
        if (!feral._d_attributes) { feral._d_attributes = {}; }
        feral._d_attributes[attribName] = String(value);
      } else {
        var sanitizedValue = rewriteAttribute(
            tagName, attribName, atype, value);
        if (sanitizedValue !== null) {
          bridal.setAttribute(feral, attribName, sanitizedValue);
        }
      }
      return value;
    });
    TameElement.prototype.removeAttribute = nodeMethod(function (attribName) {
      var feral = np(this).feral;
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      attribName = String(attribName).toLowerCase();
      var tagName = feral.tagName.toLowerCase();
      var atype = getAttributeType(tagName, attribName);
      if (atype === void 0) {
        // Unrecognized attribute; use virtual map
        if (feral._d_attributes) {
          delete feral._d_attributes[attribName];
        }
      } else {
        feral.removeAttribute(attribName);
      }
    });
    TameElement.prototype.getBoundingClientRect = nodeMethod(function () {
      var feral = np(this).feral;
      var elRect = bridal.getBoundingClientRect(feral);
      var vbody = bridal.getBoundingClientRect(
          np(this.ownerDocument).feralPseudoBodyNode);
      var vbodyLeft = vbody.left, vbodyTop = vbody.top;
      return ({
                top: elRect.top - vbodyTop,
                left: elRect.left - vbodyLeft,
                right: elRect.right - vbodyLeft,
                bottom: elRect.bottom - vbodyTop
              });
    });
    TameElement.prototype.updateStyle = nodeMethod(function (style) {
      var feral = np(this).feral;
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      var cssPropertiesAndValues = cssSealerUnsealerPair.unseal(style);
      if (!cssPropertiesAndValues) { throw new Error(); }

      var styleNode = feral.style;
      for (var i = 0; i < cssPropertiesAndValues.length; i += 2) {
        var propName = cssPropertiesAndValues[+i];
        var propValue = cssPropertiesAndValues[i + 1];
        // If the propertyName differs between DOM and CSS, there will
        // be a semicolon between the two.
        // E.g., 'background-color;backgroundColor'
        // See CssTemplate.toPropertyValueList.
        var semi = propName.indexOf(';');
        if (semi >= 0) { propName = propName.substring(semi + 1); }
        styleNode[propName] = propValue;
      }
    });
    TameElement.prototype.addEventListener =
        nodeMethod(tameAddEventListener);
    TameElement.prototype.removeEventListener =
        nodeMethod(tameRemoveEventListener);
    function innerTextOf(rawNode, out) {
      switch (rawNode.nodeType) {
        case 1:  // Element
          var tagName = rawNode.tagName.toLowerCase();
          if (html4.ELEMENTS.hasOwnProperty(tagName)
              && !(html4.ELEMENTS[tagName] & html4.eflags.UNSAFE)) {
            // Not an opaque node.
            for (var c = rawNode.firstChild; c; c = c.nextSibling) {
              makeDOMAccessible(c);
              innerTextOf(c, out);
            }
          }
          break;
        case 3:  // Text Node
        case 4:  // CDATA Section Node
          out[out.length] = rawNode.data;
          break;
        case 11:  // Document Fragment
          for (var c = rawNode.firstChild; c; c = c.nextSibling) {
            makeDOMAccessible(c);
            innerTextOf(c, out);
          }
          break;
      }
    }
    definePropertiesAwesomely(TameElement.prototype,
        commonElementPropertyHandlers);
    var innerTextProp = { 
      enumerable: true, 
      get: nodeMethod(function () {
        var text = [];
        innerTextOf(np(this).feral, text);
        return text.join('');
      }),
      set: nodeMethod(function (newText) {
        // This operation changes the child node list (but not other properties
        // of the element) so it checks childrenEditable. Note that this check
        // is critical to security, as else a client can set the innerHTML of
        // a <script> element to execute scripts.
        if (!np(this).childrenEditable) { throw new Error(NOT_EDITABLE); }
        var newTextStr = newText != null ? String(newText) : '';
        var el = np(this).feral;
        for (var c; (c = el.firstChild);) { el.removeChild(c); }
        if (newTextStr) {
          el.appendChild(el.ownerDocument.createTextNode(newTextStr));
        }
      })
    };
    definePropertiesAwesomely(TameElement.prototype, {
      id: NP.filterAttr(defaultToEmptyStr, identity),
      className: {
        enumerable: true, 
        get: nodeMethod(function () { 
          return this.getAttribute('class') || '';
        }),
        set: nodeMethod(function (classes) { 
          return this.setAttribute('class', String(classes));
        })
      },
      title: NP.filterAttr(defaultToEmptyStr, String),
      dir: NP.filterAttr(defaultToEmptyStr, String),
      innerText: innerTextProp,
      textContent: innerTextProp,
      tagName: NP.ro,
      style: NP.filter(
          false,
          nodeMethod(function (styleNode) {
            return new TameStyle(styleNode, np(this).editable, this);
          }),
          true, identity),
      innerHTML: {
        enumerable: true,
        get: nodeMethod(function () {
          var node = np(this).feral;
          var tagName = node.tagName.toLowerCase();
          if (!html4.ELEMENTS.hasOwnProperty(tagName)) {
            return '';  // unknown node
          }
          var flags = html4.ELEMENTS[tagName];
          var innerHtml = node.innerHTML;
          if (flags & html4.eflags.CDATA) {
            innerHtml = html.escapeAttrib(innerHtml);
          } else if (flags & html4.eflags.RCDATA) {
            // Make sure we return PCDATA.
            // For RCDATA we only need to escape & if they're not part of an
            // entity.
            innerHtml = html.normalizeRCData(innerHtml);
          } else {
            // If we blessed the resulting HTML, then this would round trip 
            // better but it would still not survive appending, and it would
            // propagate event handlers where the setter of innerHTML does not
            // expect it to.
            innerHtml = tameInnerHtml(innerHtml);
          }
          return innerHtml;
        }),
        set: nodeMethod(function (htmlFragment) {
          // This operation changes the child node list (but not other
          // properties of the element) so it checks childrenEditable. Note that
          // this check is critical to security, as else a client can set the
          // innerHTML of a <script> element to execute scripts.
          if (!np(this).childrenEditable) { throw new Error(NOT_EDITABLE); }
          var node = np(this).feral;
          var tagName = node.tagName.toLowerCase();
          if (!html4.ELEMENTS.hasOwnProperty(tagName)) { throw new Error(); }
          var flags = html4.ELEMENTS[tagName];
          if (flags & html4.eflags.UNSAFE) { throw new Error(); }
          var isRcData = flags & html4.eflags.RCDATA;
          var htmlFragmentString;
          if (!isRcData && htmlFragment instanceof Html) {
            htmlFragmentString = '' + safeHtml(htmlFragment);
          } else if (htmlFragment === null) {
            htmlFragmentString = '';
          } else {
            htmlFragmentString = '' + htmlFragment;
          }
          var sanitizedHtml;
          if (isRcData) {
            sanitizedHtml = html.normalizeRCData(htmlFragmentString);
          } else {
            sanitizedHtml = sanitizeHtml(htmlFragmentString);
          }
          node.innerHTML = sanitizedHtml;
          return htmlFragment;
        })
      },
      offsetParent: NP.related
    });
    cajaVM.def(TameElement);  // and its prototype
    
    traceStartup("DT: starting defineElement");
    
    /**
     * Define a taming class for a subclass of HTMLElement.
     *
     * @param {Array} record.superclass The tame superclass constructor
     *     (defaults to TameElement) with parameters (this, node, editable,
     *     childrenEditable, opt_proxyType).
     * @param {Array} record.names The element names which should be tamed using
     *     this class.
     * @param {String} record.domClass The DOM-specified class name.
     * @param {Object} record.properties The custom properties this class should
     *     have (in the format accepted by definePropertiesAwesomely).
     * @param {function} record.construct Code to invoke at the end of
     *     construction; takes and returns self.
     * @param {boolean} record.forceChildrenNotEditable Whether to force the
     *     childrenEditable flag to be false regardless of the value of
     *     editable.
     * @return {function} The constructor.
     */
    function defineElement(record) {
      var superclass = record.superclass || TameElement;
      var proxyType = record.proxyType;
      var construct = record.construct || identity;
      var forceChildrenNotEditable = record.forceChildrenNotEditable;
      function TameSpecificElement(node, editable) {
        superclass.call(this,
                        node,
                        editable,
                        editable && !forceChildrenNotEditable,
                        proxyType);
        construct.call(this);
      }
      inertCtor(TameSpecificElement, superclass, record.domClass);
      for (var i = 0; i < record.names.length; i++) {
        //console.debug("defineElement", record.names[i]);
        tamingClassesByElement[record.names[+i]] = TameSpecificElement;
      }
      definePropertiesAwesomely(TameSpecificElement.prototype,
          record.properties || {});
      // Note: cajaVM.def will be applied to all registered node classes
      // later, so users of defineElement don't need to.
      return TameSpecificElement;
    }
    cajaVM.def(defineElement);
    
    defineElement({
      names: ['a'],
      domClass: 'HTMLAnchorElement',
      properties: {
        href: NP.filter(false, identity, true, identity)
      }
    });
    
    // http://dev.w3.org/html5/spec/Overview.html#the-canvas-element
    (function() {
      // If the host browser does not have getContext, then it must not usefully
      // support canvas, so we don't either; skip registering the canvas element
      // class.
      var e = makeDOMAccessible(document.createElement('canvas'));
      if (typeof e.getContext !== 'function')
        return;
      
      // TODO(kpreid): snitched from Caja runtime; review whether we actually
      // need this (the Canvas spec says that invalid values should be ignored
      // and we don't do that in a bunch of places);
      /**
       * Enforces <tt>typeOf(specimen) === typename</tt>, in which case
       * specimen is returned.
       * <p>
       * If not, throws an informative TypeError
       * <p>
       * opt_name, if provided, should be a name or description of the
       * specimen used only to generate friendlier error messages.
       */
      function enforceType(specimen, typename, opt_name) {
        if (typeof specimen !== typename) {
          throw new Error('expected ', typename, ' instead of ',
              typeof specimen, ': ', (opt_name || specimen));
        }
        return specimen;
      }

      var TameContext2DConf = new Confidence('TameContext2D');
      var ContextP = new PropertyTaming(TameContext2DConf);

      function isFont(value) {
        return typeof(value) == "string" && css.properties.font.test(value);
      }
      function isColor(value) {
        // Note: we're testing against the pattern for the CSS "color:"
        // property, but what is actually referenced by the draft canvas spec is
        // the CSS syntactic element <color>, which is why we need to
        // specifically exclude "inherit".
        return typeof(value) == "string" && css.properties.color.test(value) &&
            value !== "inherit";
      }
      var colorNameTable = {
        // http://dev.w3.org/csswg/css3-color/#html4 as cited by
        // http://dev.w3.org/html5/2dcontext/#dom-context-2d-fillstyle
        // TODO(kpreid): avoid duplication with table in CssRewriter.java
        " black":   "#000000",
        " silver":  "#c0c0c0",
        " gray":    "#808080",
        " white":   "#ffffff",
        " maroon":  "#800000",
        " red":     "#ff0000",
        " purple":  "#800080",
        " fuchsia": "#ff00ff",
        " green":   "#008000",
        " lime":    "#00ff00",
        " olive":   "#808000",
        " yellow":  "#ffff00",
        " navy":    "#000080",
        " blue":    "#0000ff",
        " teal":    "#008080",
        " aqua":    "#00ffff"
      };
      function StringTest(strings) {
        var table = {};
        // The table itself as a value is a marker to avoid running into
        // Object.prototype properties.
        for (var i = strings.length; --i >= 0;) { table[strings[+i]] = table; }
        return cajaVM.def(function (string) {
          return typeof string === 'string' && table[string] === table;
        });
      }
      function canonColor(colorString) {
        // http://dev.w3.org/html5/2dcontext/ says the color shall be returned
        // only as #hhhhhh, not as names.
        return colorNameTable[" " + colorString] || colorString;
      }
      function TameImageData(imageData) {
        makeDOMAccessible(imageData);
        var p = TameImageDataConf.p;
        
        // Since we can't interpose indexing, we can't wrap the CanvasPixelArray
        // so we have to copy the pixel data. This is horrible, bad, and awful.
        // TODO(kpreid): No longer true in ES5-land; we can interpose but not
        // under ES5/3. Use proxies conditional on the same switch that controls
        // liveness of node lists.
        var tameImageData = {
          toString: cajaVM.def(function () {
              return "[Domita Canvas ImageData]"; }),
          width: Number(imageData.width),
          height: Number(imageData.height)
        };
        TameImageDataConf.confide(tameImageData);
        
        // used to unwrap for passing to putImageData
        p(tameImageData).feral = imageData;
        
        // lazily constructed tame copy, backs .data accessor; also used to
        // test whether we need to write-back the copy before a putImageData
        p(tameImageData).tamePixelArray = undefined;
        
        definePropertiesAwesomely(tameImageData, {
          data: {
            enumerable: true,
            // Accessor used so we don't need to copy if the client is just
            // blitting (getImageData -> putImageData) rather than inspecting
            // the pixels.
            get: cajaVM.def(function () {
              if (!p(tameImageData).tamePixelArray) {
                
                var bareArray = imageData.data;
                // Note: On Firefox 4.0.1, at least, pixel arrays cannot have
                // added properties (such as our w___). Therefore, for writing,
                // we use a special routine, and we don't do makeDOMAccessible
                // because it would have no effect. An alternative approach
                // would be to muck with the "Uint8ClampedArray" prototype.
                
                var length = bareArray.length;
                var tamePixelArray = { // not frozen, user-modifiable
                  // TODO: Investigate whether it would be an optimization to
                  // make this an array with properties added.
                  toString: cajaVM.def(function () {
                      return "[Domita CanvasPixelArray]"; }),
                  _d_canvas_writeback: function () { 
                    // This is invoked just before each putImageData

                    // TODO(kpreid): shouldn't be a public method (but is
                    // harmless).
                    
                    rulebreaker.writeToPixelArray(
                      tamePixelArray, bareArray, length);
                  }
                };
                for (var i = length-1; i >= 0; i--) {
                  tamePixelArray[+i] = bareArray[+i];
                }
                p(tameImageData).tamePixelArray = tamePixelArray;
              }
              return p(tameImageData).tamePixelArray;
            })
          }
        });
        return Object.freeze(tameImageData);
      }
      function TameGradient(gradient) {
        makeDOMAccessible(gradient);
        var tameGradient = {
          toString: cajaVM.def(function () {
              return "[Domita CanvasGradient]"; }),
          addColorStop: cajaVM.def(function (offset, color) {
            enforceType(offset, 'number', 'color stop offset');
            if (!(0 <= offset && offset <= 1)) {
              throw new Error(INDEX_SIZE_ERROR);
              // TODO(kpreid): should be a DOMException per spec
            }
            if (!isColor(color)) {
              throw new Error("SYNTAX_ERR");
              // TODO(kpreid): should be a DOMException per spec
            }
            gradient.addColorStop(offset, color);
          })
        };
        TameGradientConf.confide(tameGradient);
        TameGradientConf.p(tameGradient).feral = gradient;
        rulebreaker.tamesTo(gradient, tameGradient);
        return Object.freeze(tameGradient);
      }
      function enforceFinite(value, name) {
        enforceType(value, 'number', name);
        if (!isFinite(value)) {
          throw new Error("NOT_SUPPORTED_ERR");
          // TODO(kpreid): should be a DOMException per spec
        }
      }

      function TameCanvasElement(node, editable) {
        // TODO(kpreid): review whether this can use defineElement
        TameElement.call(this, node, editable, editable);
      
        // helpers for tame context
        var context = makeDOMAccessible(node.getContext('2d'));
        function tameFloatsOp(count, verb) {
          var m = makeFunctionAccessible(context[verb]);
          return cajaVM.def(function () {
            if (arguments.length !== count) {
              throw new Error(verb + ' takes ' + count + ' args, not ' +
                              arguments.length);
            }
            for (var i = 0; i < count; i++) {
              enforceType(arguments[+i], 'number', verb + ' argument ' + i);
            }
            // The copy-into-array is necessary in ES5/3 because host DOM
            // won't take an arguments object from inside of ES53.
            m.apply(context, Array.prototype.slice.call(arguments));
          });
        }
        function tameRectMethod(m, hasResult) {
          makeFunctionAccessible(m);
          return cajaVM.def(function (x, y, w, h) {
            if (arguments.length !== 4) {
              throw new Error(m + ' takes 4 args, not ' +
                              arguments.length);
            }
            enforceType(x, 'number', 'x');
            enforceType(y, 'number', 'y');
            enforceType(w, 'number', 'width');
            enforceType(h, 'number', 'height');
            if (hasResult) {
              return m.call(context, x, y, w, h);            
            } else {
              m.call(context, x, y, w, h);
            }
          });
        }
        function tameDrawText(m) {
          makeFunctionAccessible(m);
          return cajaVM.def(function (text, x, y, maxWidth) {
            enforceType(text, 'string', 'text');
            enforceType(x, 'number', 'x');
            enforceType(y, 'number', 'y');
            switch (arguments.length) {
            case 3:
              m.apply(context, Array.prototype.slice.call(arguments));
              return;
            case 4:
              enforceType(maxWidth, 'number', 'maxWidth');
              m.apply(context, Array.prototype.slice.call(arguments));
              return;
            default:
              throw new Error(m + ' cannot accept ' + arguments.length +
                                  ' arguments');
            }
          });
        }
        function tameGetMethod(prop) {
          return cajaVM.def(function () { return context[prop]; });
        }
        function tameSetMethod(prop, validator) {
          return cajaVM.def(function (newValue) {
            if (validator(newValue)) {
              context[prop] = newValue;
            }
            return newValue;
          });
        }
        var CP_STYLE = {
          enumerable: true,
          extendedAccessors: true,
          get: TameContext2DConf.protectMethod(function (prop) {
            var value = context[prop];
            if (typeof(value) == "string") {
              return canonColor(value);
            } else if (cajaVM.passesGuard(TameGradientT,
                                          rulebreaker.tame(value))) {
              return rulebreaker.tame(value);
            } else {
              throw new Error("Internal: Can't tame value " + value + " of " +
                   prop);
            }
          }),
          set: cajaVM.def(function (newValue, prop) {
            if (isColor(newValue)) {
              context[prop] = newValue;
            } else if (typeof(newValue) === "object" &&
                       cajaVM.passesGuard(TameGradientT, newValue)) {
              context[prop] = TameGradientConf.p(newValue).feral;
            } // else do nothing
            return newValue;
          })
        };
        function tameSimpleOp(m) {  // no return value
          makeFunctionAccessible(m);
          return cajaVM.def(function () {
            if (arguments.length !== 0) {
              throw new Error(m + ' takes no args, not ' + arguments.length);
            }
            m.call(context);
          });
        }
      
        // Design note: We generally reject the wrong number of arguments,
        // unlike default JS behavior. This is because we are just passing data
        // through to the underlying implementation, but we don't want to pass
        // on anything which might be an extension we don't know about, and it
        // is better to fail explicitly than to leave the client wondering about
        // why their extension usage isn't working.
      
        // http://dev.w3.org/html5/2dcontext/
        // TODO(kpreid): Review this for converting to prototypical objects
        var tameContext2d = np(this).tameContext2d = {
          toString: cajaVM.def(function () {
              return "[Domita CanvasRenderingContext2D]"; }),

          save: tameSimpleOp(context.save),
          restore: tameSimpleOp(context.restore),
        
          scale: tameFloatsOp(2, 'scale'),
          rotate: tameFloatsOp(1, 'rotate'),
          translate: tameFloatsOp(2, 'translate'),
          transform: tameFloatsOp(6, 'transform'),
          setTransform: tameFloatsOp(6, 'setTransform'),
        
          createLinearGradient: function (x0, y0, x1, y1) {
            if (arguments.length !== 4) {
              throw new Error('createLinearGradient takes 4 args, not ' +
                              arguments.length);
            }
            enforceType(x0, 'number', 'x0');
            enforceType(y0, 'number', 'y0');
            enforceType(x1, 'number', 'x1');
            enforceType(y1, 'number', 'y1');
            return new TameGradient(
              context.createLinearGradient(x0, y0, x1, y1));
          },
          createRadialGradient: function (x0, y0, r0, x1, y1, r1) {
            if (arguments.length !== 6) {
              throw new Error('createRadialGradient takes 6 args, not ' +
                              arguments.length);
            }
            enforceType(x0, 'number', 'x0');
            enforceType(y0, 'number', 'y0');
            enforceType(r0, 'number', 'r0');
            enforceType(x1, 'number', 'x1');
            enforceType(y1, 'number', 'y1');
            enforceType(r1, 'number', 'r1');
            return new TameGradient(context.createRadialGradient(
              x0, y0, r0, x1, y1, r1));
          },

          createPattern: function (imageElement, repetition) {
            // Consider what policy to have wrt reading the pixels from image
            // elements before implementing this.
            throw new Error('Domita: canvas createPattern not yet implemented');
          },

          clearRect:  tameRectMethod(context.clearRect,  false),
          fillRect:   tameRectMethod(context.fillRect,   false),
          strokeRect: tameRectMethod(context.strokeRect, false),

          beginPath: tameSimpleOp(context.beginPath),
          closePath: tameSimpleOp(context.closePath),
          moveTo: tameFloatsOp(2, 'moveTo'),
          lineTo: tameFloatsOp(2, 'lineTo'),
          quadraticCurveTo: tameFloatsOp(4, 'quadraticCurveTo'),
          bezierCurveTo: tameFloatsOp(6, 'bezierCurveTo'),
          arcTo: tameFloatsOp(5, 'arcTo'),
          rect: tameFloatsOp(4, 'rect'),
          arc: function (x, y, radius, startAngle, endAngle, anticlockwise) {
            if (arguments.length !== 6) {
              throw new Error('arc takes 6 args, not ' + arguments.length);
            }
            enforceType(x, 'number', 'x');
            enforceType(y, 'number', 'y');
            enforceType(radius, 'number', 'radius');
            enforceType(startAngle, 'number', 'startAngle');
            enforceType(endAngle, 'number', 'endAngle');
            enforceType(anticlockwise, 'boolean', 'anticlockwise');
            if (radius < 0) {
              throw new Error(INDEX_SIZE_ERROR);
              // TODO(kpreid): should be a DOMException per spec
            }
            context.arc(x, y, radius, startAngle, endAngle, anticlockwise);
          },
          fill: tameSimpleOp(context.fill),
          stroke: tameSimpleOp(context.stroke),
          clip: tameSimpleOp(context.clip),
        
          isPointInPath: function (x, y) {
            enforceType(x, 'number', 'x');
            enforceType(y, 'number', 'y');
            return enforceType(context.isPointInPath(x, y), 'boolean');
          },
        
          fillText: tameDrawText(context.fillText),
          strokeText: tameDrawText(context.strokeText),
          measureText: function (string) {
            if (arguments.length !== 1) {
              throw new Error('measureText takes 1 arg, not ' +
                  arguments.length);
            }
            enforceType(string, 'string', 'measureText argument');
            return context.measureText(string);
          },
        
          drawImage: function (imageElement) {
            // Consider what policy to have wrt reading the pixels from image
            // elements before implementing this.
            throw new Error('Domita: canvas drawImage not yet implemented');
          },
        
          createImageData: function (sw, sh) {
            if (arguments.length !== 2) {
              throw new Error('createImageData takes 2 args, not ' +
                              arguments.length);
            }
            enforceType(sw, 'number', 'sw');
            enforceType(sh, 'number', 'sh');
            return new TameImageData(context.createImageData(sw, sh));
          },
          getImageData: tameRectMethod(function (sx, sy, sw, sh) {
            return TameImageData(context.getImageData(sx, sy, sw, sh));
          }, true),
          putImageData: function 
              (tameImageData, dx, dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight) {
            tameImageData = TameImageDataT.coerce(tameImageData);
            enforceFinite(dx, 'dx');
            enforceFinite(dy, 'dy');
            switch (arguments.length) {
            case 3:
              dirtyX = 0;
              dirtyY = 0;
              dirtyWidth = tameImageData.width;
              dirtyHeight = tameImageData.height;
              break;
            case 7:
              enforceFinite(dirtyX, 'dirtyX');
              enforceFinite(dirtyY, 'dirtyY');
              enforceFinite(dirtyWidth, 'dirtyWidth');
              enforceFinite(dirtyHeight, 'dirtyHeight');
              break;
            default:
              throw 'putImageData cannot accept ' + arguments.length +
                  ' arguments';
            }
            var tamePixelArray =
              TameImageDataConf.p(tameImageData).tamePixelArray;
            if (tamePixelArray) {
              tamePixelArray._d_canvas_writeback();
            }
            context.putImageData(TameImageDataConf.p(tameImageData).feral,
                                 dx, dy, dirtyX, dirtyY,
                                 dirtyWidth, dirtyHeight);
          }
        };
      
        if ("drawFocusRing" in context) {
          tameContext2d.drawFocusRing = function
              (tameElement, x, y, canDrawCustom) {
            switch (arguments.length) {
            case 3:
              canDrawCustom = false;
              break;
            case 4:
              break;
            default:
              throw 'drawFocusRing cannot accept ' + arguments.length +
                  ' arguments';
            }
            tameElement = TameNodeT.coerce(tameElement);
            enforceType(x, 'number', 'x');
            enforceType(y, 'number', 'y');
            enforceType(canDrawCustom, 'boolean', 'canDrawCustom');
          
            // On safety of using the untamed node here: The only information
            // drawFocusRing takes from the node is whether it is focused.
            return enforceType(
                context.drawFocusRing(np(tameElement).feral, x, y,
                                      canDrawCustom),
                'boolean');
          };
        }
        
        definePropertiesAwesomely(tameContext2d, {
          // We filter the values supplied to setters in case some browser
          // extension makes them more powerful, e.g. containing scripting or a
          // URL.
          // TODO(kpreid): Do we want to filter the *getters* as well?
          // Scenarios: (a) canvas shared with innocent code, (b) browser
          // quirks?? If we do, then what should be done with a bad value?
          globalAlpha: ContextP.RWCond(
              function (v) { return typeof v === "number" &&
                                    0.0 <= v && v <= 1.0;     }),
          globalCompositeOperation: ContextP.RWCond(
              StringTest([
                "source-atop",
                "source-in",
                "source-out",
                "source-over",
                "destination-atop",
                "destination-in",
                "destination-out",
                "destination-over",
                "lighter",
                "copy",
                "xor"
              ])),
          strokeStyle: CP_STYLE,
          fillStyle: CP_STYLE,
          lineWidth: ContextP.RWCond(
              function (v) { return typeof v === "number" &&
                                    0.0 < v && v !== Infinity; }),
          lineCap: ContextP.RWCond(
              StringTest([
                "butt",
                "round",
                "square"
              ])),
          lineJoin: ContextP.RWCond(
              StringTest([
                "bevel",
                "round",
                "miter"
              ])),
          miterLimit: ContextP.RWCond(
                function (v) { return typeof v === "number" &&
                                      0 < v && v !== Infinity; }),
          shadowOffsetX: ContextP.RWCond(
                function (v) { return typeof v === "number" && isFinite(v); }),
          shadowOffsetY: ContextP.RWCond(
                function (v) { return typeof v === "number" && isFinite(v); }),
          shadowBlur: ContextP.RWCond(
                function (v) { return typeof v === "number" &&
                                      0.0 <= v && v !== Infinity; }),
          shadowColor: {
            enumerable: true,
            extendedAccessors: true,
            get: CP_STYLE.get,
            set: ContextP.RWCond(isColor).set
          },
        
          font: ContextP.RWCond(isFont),
          textAlign: ContextP.RWCond(
              StringTest([
                "start",
                "end",
                "left",
                "right",
                "center"
              ])),
          textBaseline: ContextP.RWCond(
              StringTest([
                "top",
                "hanging",
                "middle",
                "alphabetic",
                "ideographic",
                "bottom"
              ]))
        });
        TameContext2DConf.confide(tameContext2d);
        TameContext2DConf.p(tameContext2d).editable = np(this).editable;
        TameContext2DConf.p(tameContext2d).feral = context;
        cajaVM.def(tameContext2d);
      }  // end of TameCanvasElement
      inertCtor(TameCanvasElement, TameElement, 'HTMLCanvasElement');
      TameCanvasElement.prototype.getContext = function (contextId) {
      
        // TODO(kpreid): We can refine this by inventing a ReadOnlyCanvas object
        // to return in this situation, which allows getImageData and so on but
        // not any drawing. Not bothering to do that for now; if you have a use
        // for it let us know.
        if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      
        enforceType(contextId, 'string', 'contextId');
        switch (contextId) {
          case '2d':
            return np(this).tameContext2d;
          default:
            // http://dev.w3.org/html5/spec/the-canvas-element.html#the-canvas-element
            // says: The getContext(contextId, args...) method of the canvas
            // element, when invoked, must run the following steps:
            // [...]
            //     If contextId is not the name of a context supported by the
            //     user agent, return null and abort these steps.
            //
            // However, Mozilla throws and WebKit returns undefined instead.
            // Returning undefined rather than null is closer to the spec than
            // throwing.
            return undefined;
            throw new Error('Unapproved canvas contextId');
        }
      };
      definePropertiesAwesomely(TameCanvasElement.prototype, {
        height: NP.filter(false, identity, false, Number),
        width: NP.filter(false, identity, false, Number)
      });
      
      tamingClassesByElement['canvas'] = TameCanvasElement;
    })();

    traceStartup("DT: done with canvas");

    function FormElementAndExpandoProxyHandler(target, editable, storage) {
      ExpandoProxyHandler.call(this, target, editable, storage);
    }
    inherit(FormElementAndExpandoProxyHandler, ExpandoProxyHandler);
    setOwn(FormElementAndExpandoProxyHandler.prototype, 
        'getOwnPropertyDescriptor', function (name) {
      if (name !== 'ident___' &&
          Object.prototype.hasOwnProperty.call(this.target.elements, name)) {
        return Object.getOwnPropertyDescriptor(this.target.elements, name);
      } else {
        return ExpandoProxyHandler.prototype.getOwnPropertyDescriptor
            .call(this, name);
      }
    });
    setOwn(FormElementAndExpandoProxyHandler.prototype, 
        'get', domitaModules.permuteProxyGetSet.getter(function (name) {
      if (name !== 'ident___' &&
          Object.prototype.hasOwnProperty.call(this.target.elements, name)) {
        return this.target.elements[name];
      } else {
        return ExpandoProxyHandler.prototype.get.call(this, name);
      }
    }));
    setOwn(FormElementAndExpandoProxyHandler.prototype, 'getOwnPropertyNames',
        function () {
      // TODO(kpreid): not quite right result set
      return Object.getOwnPropertyNames(this.target.elements); 
    });
    setOwn(FormElementAndExpandoProxyHandler.prototype, 'delete',
        function (name) {
      if (name === "ident___") {
        return false;
      } else if (Object.prototype.hasOwnProperty.call(
                     this.target.elements, name)) {
        return false;
      } else {
        return ExpandoProxyHandler.prototype.delete.call(this, name);
      }
    });
    cajaVM.def(FormElementAndExpandoProxyHandler);

    var TameFormElement = defineElement({
      names: ['form'],
      domClass: 'HTMLFormElement',
      proxyType: FormElementAndExpandoProxyHandler,
      properties: {
        action: NP.filterAttr(defaultToEmptyStr, String),
        elements: {
          enumerable: true,
          get: nodeMethod(function () {
            return tameHTMLCollection(
                np(this).feral.elements, np(this).editable, defaultTameNode);
          })
        },
        enctype: NP.filterAttr(defaultToEmptyStr, String),
        method: NP.filterAttr(defaultToEmptyStr, String),
        target: NP.filterAttr(defaultToEmptyStr, String)
      },
      construct: function () {
        // Freeze length at creation time since we aren't live.
        // TODO(kpreid): Revise this when we have live node lists.
        Object.defineProperty(this, "length", {
          value: np(this).feral.length
        });
      }
    });
    TameFormElement.prototype.submit = nodeMethod(function () {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      return np(this).feral.submit();
    });
    TameFormElement.prototype.reset = nodeMethod(function () {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      return np(this).feral.reset();
    });

    var P_blacklist = {
      enumerable: true,
      extendedAccessors: true,
      get: nodeMethod(function () { return undefined; }),
      set: nodeMethod(function (value, prop) {
        if (typeof console !== 'undefined')
          console.error('Cannot set the [', prop, '] property of an iframe.');
      })
    };
    var TameIFrameElement = defineElement({
      names: ['iframe'],
      domClass: 'HTMLIFrameElement',
      construct: function () {
        np(this).childrenEditable = false;
      },
      properties: {
        align: {
          enumerable: true,
          get: nodeMethod(function () {
            return np(this).feral.align;
          }),
          set: nodeMethod(function (alignment) {
            if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
            alignment = String(alignment);
            if (alignment === 'left' ||
                alignment === 'right' ||
                alignment === 'center') {
              np(this).feral.align = alignment;
            }
          })
        },
        frameBorder: {
          enumerable: true,
          get: nodeMethod(function () {
            return np(this).feral.frameBorder;
          }),
          set: nodeMethod(function (border) {
            if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
            border = String(border).toLowerCase();
            if (border === '0' || border === '1' ||
                border === 'no' || border === 'yes') {
              np(this).feral.frameBorder = border;
            }
          })
        },
        height: NP.filterProp(identity, Number),
        width:  NP.filterProp(identity, Number),
        src: P_blacklist,
        name: P_blacklist
      }
    });
    // TODO(kpreid): Check these two (straight from Domita) for correctness 
    // vs. TameElement's version
    setOwn(TameIFrameElement.prototype, 'getAttribute',
        nodeMethod(function (attr) {
      var attrLc = String(attr).toLowerCase();
      if (attrLc !== 'name' && attrLc !== 'src') {
        return TameElement.prototype.getAttribute.call(this, attr);
      }
      return null;
    }));
    setOwn(TameIFrameElement.prototype, 'setAttribute',
        nodeMethod(function (attr, value) {
      var attrLc = String(attr).toLowerCase();
      // The 'name' and 'src' attributes are whitelisted for all tags in
      // html4-attributes-whitelist.json, since they're needed on tags
      // like <img>.  Because there's currently no way to filter attributes
      // based on the tag, we have to blacklist these two here.
      if (attrLc !== 'name' && attrLc !== 'src') {
        return TameElement.prototype.setAttribute.call(this, attr, value);
      }
      if (typeof console !== 'undefined')
        console.error('Cannot set the [' + attrLc +
            '] attribute of an iframe.');
      return value;
    }));
    
    function toInt(x) { return x | 0; }
    var TameInputElement = defineElement({
      names: ['select', 'button', 'option', 'textarea', 'input'],
      domClass: 'HTMLInputElement',
      properties: {
        checked: NP.filterProp(identity, Boolean),
        defaultChecked: NP.rw,
        value: NP.filter(
          false, function (x) { return x == null ? null : String(x); },
          false, function (x) { return x == null ? '' : '' + x; }),
        defaultValue: NP.filter(
          false, function (x) { return x == null ? null : String(x); },
          false, function (x) { return x == null ? '' : '' + x; }),
        form: NP.related,
        disabled: NP.rw,
        readOnly: NP.rw,
        options: {
          enumerable: true,
          get: nodeMethod(function () {
            return tameOptionsList(np(this).feral.options, np(this).editable,
                defaultTameNode, 'name');
          })
        },
        selected: NP.rw,
        defaultSelected: NP.filterProp(identity, Boolean),
        selectedIndex: NP.filterProp(identity, toInt),
        name: NP.rw,
        accessKey: NP.rw,
        tabIndex: NP.rw,
        text: NP.filter(false, String),
        maxLength: NP.rw,
        size: NP.rw,
        type: NP.rw,
        index: NP.rw,
        label: NP.rw,
        multiple: NP.rw,
        cols: NP.rw,
        rows: NP.rw
      }
    });
    TameInputElement.prototype.select = nodeMethod(function () {
      np(this).feral.select();
    });
    
    defineElement({
      names: ['img'],
      domClass: 'HTMLImageElement',
      properties: {
        src: NP.filter(false, identity, true, identity),
        alt: NP.filterProp(identity, String)
      }
    });
    
    defineElement({
      names: ['label'],
      domClass: 'HTMLLabelElement',
      properties: {
        htmlFor: NP.Rename("for", NP.filterAttr(identity, identity))
      }
    });
    
    defineElement({
      names: ['script'],
      domClass: 'HTMLScriptElement',
      forceChildrenNotEditable: true,
      properties: {
        src: NP.filter(false, identity, true, identity)
      }
    });
    
    var TameTableCompElement = defineElement({
      names: ['td', 'thead', 'tfoot', 'tbody', 'th'],
      properties: {
        colSpan: NP.filterProp(identity, identity),
        cells: {
          // TODO(kpreid): It would be most pleasing to find a way to generalize
          // all the accessors which are of the form
          //     return tameNodeList(np(this).feral...., ..., ...)
          enumerable: true,
          get: nodeMethod(function () {
            return tameNodeList(
                np(this).feral.cells, np(this).editable, defaultTameNode);
          })
        },
        cellIndex: NP.ro,
        rowSpan: NP.filterProp(identity, identity),
        rows: {
          enumerable: true,
          get: nodeMethod(function () {
            return tameNodeList(
                np(this).feral.rows, np(this).editable, defaultTameNode);
          })
        },
        rowIndex: NP.ro,
        sectionRowIndex: NP.ro,
        align: NP.filterProp(identity, identity),
        vAlign: NP.filterProp(identity, identity),
        nowrap: NP.filterProp(identity, identity)
      }
    });
    TameTableCompElement.prototype.insertRow = nodeMethod(function (index) {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      requireIntIn(index, -1, np(this).feral.rows.length);
      return defaultTameNode(np(this).feral.insertRow(index),
          np(this).editable);
    });
    TameTableCompElement.prototype.deleteRow = nodeMethod(function (index) {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      requireIntIn(index, -1, np(this).feral.rows.length);
      np(this).feral.deleteRow(index);
    });
    
    function requireIntIn(idx, min, max) {
      if (idx !== (idx | 0) || idx < min || idx > max) {
        throw new Error(INDEX_SIZE_ERROR);
      }
    }
    
    var TameTableRowElement = defineElement({
      superclass: TameTableCompElement,
      names: ['tr'],
      domClass: 'HTMLTableRowElement'
    });
    TameTableRowElement.prototype.insertCell = nodeMethod(function (index) {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      requireIntIn(index, -1, np(this).feral.cells.length);
      return defaultTameNode(
          np(this).feral.insertCell(index),
          np(this).editable);
    });
    TameTableRowElement.prototype.deleteCell = nodeMethod(function (index) {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      requireIntIn(index, -1, np(this).feral.cells.length);
      np(this).feral.deleteCell(index);
    });
    
    var TameTableElement = defineElement({
      superclass: TameTableCompElement,
      names: ['table'],
      domClass: 'HTMLTableElement',
      properties: {
        tBodies: {
          enumerable: true,
          get: nodeMethod(function () {
            return tameNodeList(
                np(this).feral.tBodies, np(this).editable, defaultTameNode);
          })
        },
        tHead: NP_tameDescendant,
        tFoot: NP_tameDescendant,
        cellPadding: NP.filterAttr(Number, fromInt),
        cellSpacing: NP.filterAttr(Number, fromInt),
        border:      NP.filterAttr(Number, fromInt)
      }
    });
    TameTableElement.prototype.createTHead = nodeMethod(function () {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      return defaultTameNode(np(this).feral.createTHead(), np(this).editable);
    });
    TameTableElement.prototype.deleteTHead = nodeMethod(function () {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      np(this).feral.deleteTHead();
    });
    TameTableElement.prototype.createTFoot = nodeMethod(function () {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      return defaultTameNode(np(this).feral.createTFoot(), np(this).editable);
    });
    TameTableElement.prototype.deleteTFoot = nodeMethod(function () {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      np(this).feral.deleteTFoot();
    });
    TameTableElement.prototype.createCaption = nodeMethod(function () {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      return defaultTameNode(np(this).feral.createCaption(), np(this).editable);
    });
    TameTableElement.prototype.deleteCaption = nodeMethod(function () {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      np(this).feral.deleteCaption();
    });
    TameTableElement.prototype.insertRow = nodeMethod(function (index) {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      requireIntIn(index, -1, np(this).feral.rows.length);
      return defaultTameNode(np(this).feral.insertRow(index),
          np(this).editable);
    });
    TameTableElement.prototype.deleteRow = nodeMethod(function (index) {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      requireIntIn(index, -1, np(this).feral.rows.length);
      np(this).feral.deleteRow(index);
    });
    
    traceStartup("DT: done with specific elements");
    
    function fromInt(x) { return '' + (x | 0); }  // coerce null and false to 0
    
    function tameEvent(event) {
      makeDOMAccessible(event);
      if (!rulebreaker.hasTameTwin(event)) {
        var tamed = new TameEvent(event);
        rulebreaker.tamesTo(event, tamed);
      }
      return rulebreaker.tame(event);
    }

    var ep = TameEventConf.p.bind(TameEventConf);
    
    var EP_RELATED = {
      enumerable: true,
      extendedAccessors: true,
      get: eventMethod(function (prop) {
        // TODO(kpreid): Isn't it unsafe to be always editable=true here?
        return tameRelatedNode(ep(this).feral[prop], true,
            defaultTameNode);
      })
    };
    
    function P_e_view(transform) {
      return {
        enumerable: true,
        extendedAccessors: true,
        get: eventMethod(function (prop) {
          return transform(ep(this).feral[prop]);
        })
      };
    }
    
    function TameEvent(event) {
      assert(!!event);
      TameEventConf.confide(this);
      ep(this).feral = event;
      return this;
    }
    inertCtor(TameEvent, Object, 'Event');
    definePropertiesAwesomely(TameEvent.prototype, {
      type: {
        enumerable: true,
        get: eventMethod(function () {
          return bridal.untameEventType(String(ep(this).feral.type));
        })
      },
      target: {
        enumerable: true,
        get: eventMethod(function () {
          var event = ep(this).feral;
          return tameRelatedNode(
              event.target || event.srcElement, true, defaultTameNode);
        })
      },
      srcElement: {
        enumerable: true,
        get: eventMethod(function () {
          return tameRelatedNode(ep(this).feral.srcElement, true, 
              defaultTameNode);
        })
      },
      currentTarget: {
        enumerable: true,
        get: eventMethod(function () {
          var e = ep(this).feral;
          return tameRelatedNode(e.currentTarget, true, defaultTameNode);
        })
      },
      relatedTarget: {
        enumerable: true,
        get: eventMethod(function () {
          var e = ep(this).feral;
          var t = e.relatedTarget;
          if (!t) {
            if (e.type === 'mouseout') {
              t = e.toElement;
            } else if (e.type === 'mouseover') {
              t = e.fromElement;
            }
          }
          return tameRelatedNode(t, true, defaultTameNode);
        }),
        // relatedTarget is read-only.  this dummy setter is because some code
        // tries to workaround IE by setting a relatedTarget when it's not set.
        // code in a sandbox can't tell the difference between "falsey because
        // relatedTarget is not supported" and "falsey because relatedTarget is
        // outside sandbox".
        set: eventMethod(function () {})
      },
      fromElement: EP_RELATED,
      toElement: EP_RELATED,
      pageX: P_e_view(Number),
      pageY: P_e_view(Number),
      altKey: P_e_view(Boolean),
      ctrlKey: P_e_view(Boolean),
      metaKey: P_e_view(Boolean),
      shiftKey: P_e_view(Boolean),
      button: P_e_view(function (v) { return v && Number(v); }),
      clientX: P_e_view(Number),
      clientY: P_e_view(Number),
      screenX: P_e_view(Number),
      screenY: P_e_view(Number),
      which: P_e_view(function (v) { return v && Number(v); }),
      keyCode: P_e_view(function (v) { return v && Number(v); })
    });
    TameEvent.prototype.stopPropagation = eventMethod(function () {
      // TODO(mikesamuel): make sure event doesn't propagate to dispatched
      // events for this gadget only.
      // But don't allow it to stop propagation to the container.
      if (ep(this).feral.stopPropagation) {
        ep(this).feral.stopPropagation();
      } else {
        ep(this).feral.cancelBubble = true;
      }
    });
    TameEvent.prototype.preventDefault = eventMethod(function () {
      // TODO(mikesamuel): make sure event doesn't propagate to dispatched
      // events for this gadget only.
      // But don't allow it to stop propagation to the container.
      if (ep(this).feral.preventDefault) {
        ep(this).feral.preventDefault();
      } else {
        ep(this).feral.returnValue = false;
      }
    });
    setOwn(TameEvent.prototype, "toString", eventMethod(function () {
      return '[domado object Event]';
    }));
    cajaVM.def(TameEvent);  // and its prototype
    
    function TameCustomHTMLEvent(event) {
      var self;
      if (domitaModules.proxiesAvailable) {
        Object.preventExtensions(this);  // required by ES5/3 proxy emulation
        self = Proxy.create(
            new ExpandoProxyHandler(this, true, {}),
            TameEvent.call(this, event));
        ExpandoProxyHandler.register(self, this);
        TameEventConf.confide(self, this);
      } else {
        self = this;
      }
      
      return self;
    }
    inherit(TameCustomHTMLEvent, TameEvent);
    TameCustomHTMLEvent.prototype.initEvent
        = eventMethod(function (type, bubbles, cancelable) {
      bridal.initEvent(ep(this).feral, type, bubbles, cancelable);
    });
    setOwn(TameCustomHTMLEvent.prototype, "toString", eventMethod(function () {
      return '[Fake CustomEvent]';
    }));
    cajaVM.def(TameCustomHTMLEvent);  // and its prototype

    var viewProperties = {
      // We define all the window positional properties relative to
      // the fake body element to maintain the illusion that the fake
      // document is completely defined by the nodes under the fake body.
      clientLeft: {
        get: function () {
          return np(tameDocument).feralPseudoBodyNode.clientLeft;
        }
      },
      clientTop: {
        get: function () {
          return np(tameDocument).feralPseudoBodyNode.clientTop;
        }
      },
      clientHeight: {
        get: function () {
          return np(tameDocument).feralPseudoBodyNode.clientHeight;
        }
      },
      clientWidth: {
        get: function () {
          return np(tameDocument).feralPseudoBodyNode.clientWidth;
        }
      },
      offsetLeft: {
        get: function () {
          return np(tameDocument).feralPseudoBodyNode.offsetLeft;
        }
      },
      offsetTop: {
        get: function () {
          return np(tameDocument).feralPseudoBodyNode.offsetTop;
        }
      },
      offsetHeight: {
        get: function () {
          return np(tameDocument).feralPseudoBodyNode.offsetHeight;
        }
      },
      offsetWidth: {
        get: function () {
          return np(tameDocument).feralPseudoBodyNode.offsetWidth;
        }
      },
      // page{X,Y}Offset appear only as members of window, not on all elements
      // but http://www.howtocreate.co.uk/tutorials/javascript/browserwindow
      // says that they are identical to the scrollTop/Left on all browsers but
      // old versions of Safari.
      pageXOffset: {
        get: function () {
          return np(tameDocument).feralPseudoBodyNode.scrollLeft;
        }
      },
      pageYOffset: {
        get: function () {
          return np(tameDocument).feralPseudoBodyNode.scrollTop;
        }
      },
      scrollLeft: {
        get: function () {
          return np(tameDocument).feralPseudoBodyNode.scrollLeft;
        },
        set: function (x) { 
            np(tameDocument).feralPseudoBodyNode.scrollLeft = +x; }
      },
      scrollTop: {
        get: function () {
          return np(tameDocument).feralPseudoBodyNode.scrollTop;
        },
        set: function (y) {
          np(tameDocument).feralPseudoBodyNode.scrollTop = +y;
        }
      },
      scrollHeight: {
        get: function () {
          return np(tameDocument).feralPseudoBodyNode.scrollHeight;
        }
      },
      scrollWidth: {
        get: function () {
          return np(tameDocument).feralPseudoBodyNode.scrollWidth;
        }
      }
    };
    forOwnKeys(viewProperties, function (prop, desc) {
      cajaVM.def(desc.get);
      if (desc.set) cajaVM.def(desc.set);
      desc.enumerable = true;
    });
    
    function TameHTMLDocument(doc, body, domain, editable) {
      traceStartup("DT: TameHTMLDocument begin");
      TamePseudoNode.call(this, editable);

      np(this).feralDoc = doc;
      np(this).feralPseudoBodyNode = body;
      np(this).onLoadListeners = [];
      
      traceStartup("DT: TameHTMLDocument done private");
      
      var tameBody = defaultTameNode(body, editable);
      np(this).tamePseudoBodyNode = tameBody;
      // TODO(mikesamuel): create a proper class for BODY, HEAD, and HTML along
      // with all the other specialized node types.
      var tameBodyElement = new TamePseudoElement(
          'BODY',
          this,
          function () {
            return tameNodeList(body.childNodes, editable, defaultTameNode);
          },
          function () { return tameHtmlElement; },
          function () { return tameInnerHtml(body.innerHTML); },
          tameBody,
          editable);
      for (var k in {
        appendChild: 0, removeChild: 0, insertBefore: 0, replaceChild: 0
      }) {
        setOwn(tameBodyElement, k, tameBody[k].bind(tameBody));
      }
      traceStartup("DT: TameHTMLDocument applying view properties",
          viewProperties);
      definePropertiesAwesomely(ExpandoProxyHandler.unwrap(tameBodyElement),
          viewProperties);

      traceStartup("DT: TameHTMLDocument tameTitle");
      var title = doc.createTextNode(body.getAttribute('title') || '');
      makeDOMAccessible(title);
      var tameTitleElement = finishNode(new TamePseudoElement(
          'TITLE',
          this,
          function () { return [defaultTameNode(title, false)]; },
          function () { return tameHeadElement; },
          function () { return html.escapeAttrib(title.nodeValue); },
          null,
          editable));
      traceStartup("DT: TameHTMLDocument tameHead");
      var tameHeadElement = finishNode(new TamePseudoElement(
          'HEAD',
          this,
          function () { return [tameTitleElement]; },
          function () { return tameHtmlElement; },
          function () {
            return '<title>' + tameTitleElement.innerHTML + '</title>';
          },
          null,
          editable));
      var tameHtmlElement = new TamePseudoElement(  // finished later
          'HTML',
          this,
          function () { return [tameHeadElement, tameBodyElement]; },
          function () { return tamingProxies.get(this); },
          function () {
            return ('<head>' + tameHeadElement.innerHTML
                    + '<\/head><body>'
                    + tameBodyElement.innerHTML + '<\/body>');
          },
          tameBody,
          editable);
      definePropertiesAwesomely(ExpandoProxyHandler.unwrap(tameHtmlElement),
          viewProperties);
      
      // TODO(kpreid): Move this to a TamePseudoHTMLElement constructor?
      if (body.contains) {  // typeof is 'object' on IE
        tameHtmlElement.contains = nodeMethod(function (other) {
          other = TameNodeT.coerce(other);
          var otherNode = np(other).feral;
          return body.contains(otherNode);
        });
      }
      if ('function' === typeof body.compareDocumentPosition) {
        /**
         * Speced in <a href="http://www.w3.org/TR/DOM-Level-3-Core/core.html#Node3-compareDocumentPosition">DOM-Level-3</a>.
         */
        tameHtmlElement.compareDocumentPosition = nodeMethod(function (other) {
          other = TameNodeT.coerce(other);
          var otherNode = np(other).feral;
          if (!otherNode) { return 0; }
          var bitmask = +body.compareDocumentPosition(otherNode);
          // To avoid leaking information about the relative positioning of
          // different roots, if neither contains the other, then we mask out
          // the preceding/following bits.
          // 0x18 is (CONTAINS | CONTAINED).
          // 0x1f is all the bits documented at
          // http://www.w3.org/TR/DOM-Level-3-Core/core.html#DocumentPosition
          // except IMPLEMENTATION_SPECIFIC.
          // 0x01 is DISCONNECTED.
          /*
          if (!(bitmask & 0x18)) {
            // TODO: If they are not under the same virtual doc root, return
            // DOCUMENT_POSITION_DISCONNECTED instead of leaking information
            // about PRECEEDED | FOLLOWING.
          }
          */
          return bitmask & 0x1f;
        });
        if (!tameHtmlElement.hasOwnProperty('contains')) {
          // http://www.quirksmode.org/blog/archives/2006/01/contains_for_mo.html
          tameHtmlElement.contains = nodeMethod(function (other) {
            var docPos = this.compareDocumentPosition(other);
            return !(!(docPos & 0x10) && docPos);
          }).bind(tameHtmlElement);
        }
      }

      tameHtmlElement = finishNode(tameHtmlElement);

      definePropertiesAwesomely(this, {
        documentElement: P_constant(tameHtmlElement),
        domain: P_constant(domain),
        title: P_constant(tameTitleElement)
      });
    }
    inertCtor(TameHTMLDocument, TamePseudoNode, 'HTMLDocument');
    definePropertiesAwesomely(TameHTMLDocument.prototype, {
      nodeType: P_constant(9),
      nodeName: P_constant('#document'),
      nodeValue: P_constant(null),
      childNodes: { enumerable: true, get: nodeMethod(function () {
        return fakeNodeList([this.documentElement]);
      })},
      attributes: { enumerable: true, get: nodeMethod(function () {
        return fakeNodeList([]);
      })},
      parentNode: P_constant(null),
      body: { enumerable: true, get: cajaVM.def(function () {
        // Not nodeMethod function; is used before trademark applied.
        return this.documentElement.lastChild;
      })},
      forms: { enumerable: true, get: nodeMethod(function () {
        var tameForms = [];
        for (var i = 0; i < document.forms.length; i++) {
          var tameForm = tameRelatedNode(
            makeDOMAccessible(document.forms).item(i),
            np(this).editable, defaultTameNode);
          // tameRelatedNode returns null if the node is not part of
          // this node's virtual document.
          if (tameForm !== null) { tameForms.push(tameForm); }
        }
        return fakeNodeList(tameForms);
      })},
      compatMode: P_constant('CSS1Compat'),
      ownerDocument: P_constant(null)
    });
    TameHTMLDocument.prototype.getElementsByTagName = nodeMethod(
        function (tagName) {
      tagName = String(tagName).toLowerCase();
      switch (tagName) {
        case 'body': return fakeNodeList([ this.body ]);
        case 'head': return fakeNodeList([ this.documentElement.firstChild ]);
        case 'title': return fakeNodeList([ this.title ]);
        case 'html': return fakeNodeList([ this.documentElement ]);
        default:
          var extras;
          if (tagName === '*') {
            extras = [
              this.documentElement,
              this.documentElement.firstChild,
              this.title,
              this.body
            ];
          } else {
            extras = [];
          }
          return tameGetElementsByTagName(
              np(this).feralPseudoBodyNode, tagName, np(this).editable, extras);
      }
    });
    TameHTMLDocument.prototype.getElementsByClassName = nodeMethod(
        function (className) {
      return tameGetElementsByClassName(
          np(this).feralPseudoBodyNode, className, np(this).editable);
    });
    TameHTMLDocument.prototype.addEventListener =
        nodeMethod(function (name, listener, useCapture) {
          return np(this).tamePseudoBodyNode.addEventListener(
              name, listener, useCapture);
        });
    TameHTMLDocument.prototype.removeEventListener =
        nodeMethod(function (name, listener, useCapture) {
          return np(this).tamePseudoBodyNode.removeEventListener(
              name, listener, useCapture);
        });
    TameHTMLDocument.prototype.createComment = nodeMethod(function (text) {
      return defaultTameNode(np(this).feralDoc.createComment(" "), true);
    });
    TameHTMLDocument.prototype.createDocumentFragment = nodeMethod(function () {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      return defaultTameNode(np(this).feralDoc.createDocumentFragment(), true);
    });
    TameHTMLDocument.prototype.createElement = nodeMethod(function (tagName) {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      tagName = String(tagName).toLowerCase();
      if (!html4.ELEMENTS.hasOwnProperty(tagName)) {
        throw new Error(UNKNOWN_TAGNAME + "[" + tagName + "]");
      }
      var flags = html4.ELEMENTS[tagName];
      // Script exemption allows dynamic loading of proxied scripts.
      if ((flags & html4.eflags.UNSAFE) && !(flags & html4.eflags.SCRIPT)) {
        if (typeof console !== 'undefined') {
          console.log(
              UNSAFE_TAGNAME + "[" + tagName + "]: no action performed");
        }
        return null;
      }
      var newEl = np(this).feralDoc.createElement(tagName);
      if ("canvas" == tagName) {
        bridal.initCanvasElement(newEl);
      }
      if (elementPolicies.hasOwnProperty(tagName)) {
        var attribs = elementPolicies[tagName]([]);
        if (attribs) {
          for (var i = 0; i < attribs.length; i += 2) {
            bridal.setAttribute(newEl, attribs[+i], attribs[i + 1]);
          }
        }
      }
      return defaultTameNode(newEl, true);
    });
    TameHTMLDocument.prototype.createTextNode = nodeMethod(function (text) {
      if (!np(this).editable) { throw new Error(NOT_EDITABLE); }
      return defaultTameNode(np(this).feralDoc.createTextNode(
          text !== null && text !== void 0 ? '' + text : ''), true);
    });
    TameHTMLDocument.prototype.getElementById = nodeMethod(function (id) {
      id += idSuffix;
      var node = np(this).feralDoc.getElementById(id);
      return defaultTameNode(node, np(this).editable);
    });
    // http://www.w3.org/TR/DOM-Level-2-Events/events.html
    // #Events-DocumentEvent-createEvent
    TameHTMLDocument.prototype.createEvent = nodeMethod(function (type) {
      type = String(type);
      if (type !== 'HTMLEvents') {
        // See https://developer.mozilla.org/en/DOM/document.createEvent#Notes
        // for a long list of event ypes.
        // See http://www.w3.org/TR/DOM-Level-2-Events/events.html
        // #Events-eventgroupings
        // for the DOM2 list.
        throw new Error('Unrecognized event type ' + type);
      }
      var document = np(this).feralDoc;
      var rawEvent;
      if (document.createEvent) {
        rawEvent = document.createEvent(type);
      } else {
        rawEvent = document.createEventObject();
        rawEvent.eventType = 'ondataavailable';
      }
      var tamedEvent = new TameCustomHTMLEvent(rawEvent);
      rulebreaker.tamesTo(rawEvent, tamedEvent);
      return tamedEvent;
    });
    TameHTMLDocument.prototype.write = nodeMethod(function () {
      if (typeof domicile.writeHook !== 'function') {
        throw new Error('document.write not provided for this document');
      }
      domicile.writeHook.apply(undefined, arguments);
    });
    TameHTMLDocument.prototype.writeln = nodeMethod(function () {
      if (typeof domicile.writeHook !== 'function') {
        throw new Error('document.writeln not provided for this document');
      }
      // We don't write the \n separately rather than copying args, because the
      // HTML parser would rather get fewer larger chunks.
      var args = Array.slice.call(arguments, 0);
      args.push("\n");
      domicile.writeHook.apply(undefined, args);
    });
    cajaVM.def(TameHTMLDocument);  // and its prototype
    
    // Called by the html-emitter when the virtual document has been loaded.
    domicile.signalLoaded = cajaVM.def(function () {
      // TODO(kpreid): Review if this rewrite of the condition here is correct
      var onload = tameWindow.onload;
      if (onload) {
        window.setTimeout(onload, 0);
      }
      var self = tameDocument;
      var listeners = np(self).onLoadListeners;
      np(self).onLoadListeners = [];
      for (var i = 0, n = listeners.length; i < n; ++i) {
        window.setTimeout(listeners[+i], 0);
      }
    });
    
    // For JavaScript handlers.  See function dispatchEvent below
    domicile.handlers = [];
    domicile.TameHTMLDocument = TameHTMLDocument;  // Exposed for testing
    domicile.tameNode = cajaVM.def(defaultTameNode);
    domicile.feralNode = cajaVM.def(function (tame) {
      return np(tame).feral;  // NOTE: will be undefined for pseudo nodes
    });
    domicile.tameEvent = cajaVM.def(tameEvent);
    domicile.blessHtml = cajaVM.def(blessHtml);
    domicile.blessCss = cajaVM.def(function (var_args) {
      var arr = [];
      for (var i = 0, n = arguments.length; i < n; ++i) {
        arr[+i] = arguments[+i];
      }
      return cssSealerUnsealerPair.seal(arr);
    });
    domicile.htmlAttr = cajaVM.def(function (s) {
      return html.escapeAttrib(String(s || ''));
    });
    domicile.html = cajaVM.def(safeHtml);
    domicile.rewriteUri = cajaVM.def(function (uri, mimeType) {
      var s = rewriteAttribute(null, null, html4.atype.URI, uri);
      if (!s) { throw new Error(); }
      return s;
    });
    domicile.suffix = cajaVM.def(function (nmtokens) {
      var p = String(nmtokens).replace(/^\s+|\s+$/g, '').split(/\s+/g);
      var out = [];
      for (var i = 0; i < p.length; ++i) {
        var nmtoken = rewriteAttribute(null, null, html4.atype.ID, p[+i]);
        if (!nmtoken) { throw new Error(nmtokens); }
        out.push(nmtoken);
      }
      return out.join(' ');
    });
    domicile.ident = cajaVM.def(function (nmtokens) {
      var p = String(nmtokens).replace(/^\s+|\s+$/g, '').split(/\s+/g);
      var out = [];
      for (var i = 0; i < p.length; ++i) {
        var nmtoken = rewriteAttribute(null, null, html4.atype.CLASSES, p[+i]);
        if (!nmtoken) { throw new Error(nmtokens); }
        out.push(nmtoken);
      }
      return out.join(' ');
    });
    domicile.rewriteUriInCss = cajaVM.def(function (value) {
      return value
        ? uriCallback.rewrite(value, html4.ueffects.SAME_DOCUMENT,
              html4.ltypes.SANDBOXED, {})
        : void 0;
    });
    domicile.rewriteUriInAttribute = cajaVM.def(
        function (value, tagName, attribName) {
      return value
        ? uriCallback.rewrite(value, getUriEffect(tagName, attribName),
              getLoaderType(tagName, attribName), {"XML_ATTR": attribName})
        : void 0;
    });
    
    var aStyleForCPC = document.documentElement.style;
    makeDOMAccessible(aStyleForCPC);
    var allCssProperties = domitaModules.CssPropertiesCollection(
        css.properties, aStyleForCPC, css);
    var historyInsensitiveCssProperties = domitaModules.CssPropertiesCollection(
        css.HISTORY_INSENSITIVE_STYLE_WHITELIST, aStyleForCPC, css);

    // Sealed internals for TameStyle objects, not to be exposed.
    var TameStyleConf = new Confidence('Style');

    traceStartup("DT: preparing Style");

    function allowProperty(cssPropertyName) {
      return allCssProperties.isCssProp(cssPropertyName);
    };

    /**
     * http://www.w3.org/TR/DOM-Level-2-Style/css.html#CSS-CSSStyleDeclaration
     */
    function TameStyle(style, editable, tameEl) {
      makeDOMAccessible(style);
      
      TameStyleConf.confide(this);
      TameStyleConf.p(this).feral = style;
      TameStyleConf.p(this).editable = editable;
      TameStyleConf.p(this).tameElement = tameEl;
      
      TameStyleConf.p(this).readByCanonicalName = function(canonName) {
        return String(style[canonName] || '');
      };
      TameStyleConf.p(this).writeByCanonicalName = function(canonName, val) {
        style[canonName] = val;
      };
    }
    inertCtor(TameStyle, Object, 'Style');
    TameStyle.prototype.getPropertyValue =
        cajaVM.def(function (cssPropertyName) {
      cssPropertyName = String(cssPropertyName || '').toLowerCase();
      if (!allowProperty(cssPropertyName)) { return ''; }
      var canonName = allCssProperties.getCanonicalPropFromCss(cssPropertyName);
      return TameStyleConf.p(this).readByCanonicalName(canonName);
    });
    setOwn(TameStyle.prototype, "toString", cajaVM.def(function () {
      return '[domado object Style]';
    }));
    definePropertiesAwesomely(TameStyle.prototype, {
      cssText: {
        enumerable: canHaveEnumerableAccessors,
        set: cajaVM.def(function (value) {
          var p = TameStyleConf.p(this);
          if (typeof p.feral.cssText === 'string') {
            p.feral.cssText = sanitizeStyleAttrValue(value);
          } else {
            // If the browser doesn't support setting cssText, then fall back
            // to setting the style attribute of the containing element.  This
            // won't work for style declarations that are part of stylesheets
            // and not attached to elements.
            p.tameElement.setAttribute('style', value);
          }
          return true;
        })
      }
    });
    allCssProperties.forEachCanonical(function (stylePropertyName) {
      // TODO(kpreid): make each of these generated accessors more
      // specialized for this name to reduce runtime cost.
      Object.defineProperty(TameStyle.prototype, stylePropertyName, {
        enumerable: canHaveEnumerableAccessors,
        get: cajaVM.def(function () {
          if (!TameStyleConf.p(this).feral
              || !allCssProperties.isCanonicalProp(stylePropertyName)) {
            return void 0;
          }
          var cssPropertyName =
              allCssProperties.getCssPropFromCanonical(stylePropertyName);
          if (!allowProperty(cssPropertyName)) { return void 0; }
          var canonName =
              allCssProperties.getCanonicalPropFromCss(cssPropertyName);
          return TameStyleConf.p(this).readByCanonicalName(canonName);
        }),
        set: cajaVM.def(function (value) {
          var p = TameStyleConf.p(this);
          if (!p.editable) { throw new Error('style not editable'); }
          stylePropertyName = String(stylePropertyName);
          if (!allCssProperties.isCanonicalProp(stylePropertyName)) {
            throw new Error('Unknown CSS property name ' + stylePropertyName);
          }
          var cssPropertyName =
              allCssProperties.getCssPropFromCanonical(stylePropertyName);
          if (!allowProperty(cssPropertyName)) { return void 0; }
          var pattern = css.properties[cssPropertyName];
          if (!pattern) { throw new Error('style not editable'); }
          var val = '' + (value || '');
          // CssPropertyPatterns.java only allows styles of the form
          // url("...").  See the BUILTINS definition for the "uri" symbol.
          val = val.replace(
              /\burl\s*\(\s*\"([^\"]*)\"\s*\)/gi,
              function (_, url) {
                var decodedUrl = decodeCssString(url);
                var rewrittenUrl = uriCallback
                    ? uriCallback.rewrite(
                        decodedUrl, html4.ueffects.SAME_DOCUMENT,
                        html4.ltypes.SANDBOXED, { "CSS_PROP": cssPropertyName})
                    : null;
                if (!rewrittenUrl) {
                  rewrittenUrl = 'about:blank';
                }
                return 'url("'
                    + rewrittenUrl.replace(
                        /[\"\'\{\}\(\):\\]/g,
                        function (ch) {
                          return '\\' + ch.charCodeAt(0).toString(16) + ' ';
                        })
                    + '")';
              });
          if (val && !pattern.test(val + ' ')) {
            throw new Error('bad value `' + val + '` for CSS property '
                            + stylePropertyName);
          }
          var canonName =
              allCssProperties.getCanonicalPropFromCss(cssPropertyName);
          p.writeByCanonicalName(canonName, val);
          return true;
        })
      });
    });
    cajaVM.def(TameStyle);  // and its prototype

    function isNestedInAnchor(rawElement) {
      for ( ; rawElement && rawElement != pseudoBodyNode;
           rawElement = rawElement.parentNode) {
        if (rawElement.tagName.toLowerCase() === 'a') { return true; }
      }
      return false;
    }

    traceStartup("DT: about to TameComputedStyle");
    
    function TameComputedStyle(rawElement, pseudoElement) {
      rawElement = rawElement || document.createElement('div');
      TameStyle.call(
          this,
          bridal.getComputedStyle(rawElement, pseudoElement),
          false);
      TameStyleConf.p(this).rawElement = rawElement;
      TameStyleConf.p(this).pseudoElement = pseudoElement;

      var superReadByCanonicalName = TameStyleConf.p(this).readByCanonicalName;
      TameStyleConf.p(this).readByCanonicalName = function(canonName) {
        var canReturnDirectValue =
            historyInsensitiveCssProperties.isCanonicalProp(canonName)
            || !isNestedInAnchor(this.rawElement);
        if (canReturnDirectValue) {
          return superReadByCanonicalName.call(this, canonName);
        } else {
          return TameStyleConf.p(
                  new TameComputedStyle(pseudoBodyNode, this.pseudoElement))
              .readByCanonicalName(canonName);
        }
      };
      TameStyleConf.p(this).writeByCanonicalName = function(canonName) {
        throw 'Computed styles not editable: This code should be unreachable';
      };
    }
    inertCtor(TameComputedStyle, TameStyle);
    setOwn(TameComputedStyle.prototype, "toString", cajaVM.def(function () {
      return '[Fake Computed Style]';
    }));
    cajaVM.def(TameComputedStyle);  // and its prototype

    traceStartup("DT: about to make XMLHttpRequest");
    // Note: nodeClasses.XMLHttpRequest is a ctor that *can* be directly
    // called by cajoled code, so we do not use inertCtor().
    nodeClasses.XMLHttpRequest = domitaModules.TameXMLHttpRequest(
        rulebreaker,
        domitaModules.XMLHttpRequestCtor(
            makeFunctionAccessible(window.XMLHttpRequest),
            makeFunctionAccessible(window.ActiveXObject)),
        uriCallback);
    cajaVM.def(nodeClasses.XMLHttpRequest);
    traceStartup("DT: done for XMLHttpRequest");

    /**
     * given a number, outputs the equivalent css text.
     * @param {number} num
     * @return {string} an CSS representation of a number suitable for both html
     *    attribs and plain text.
     */
    domicile.cssNumber = cajaVM.def(function (num) {
      if ('number' === typeof num && isFinite(num) && !isNaN(num)) {
        return '' + num;
      }
      throw new Error(num);
    });
    /**
     * given a number as 24 bits of RRGGBB, outputs a properly formatted CSS
     * color.
     * @param {number} num
     * @return {string} a CSS representation of num suitable for both html
     *    attribs and plain text.
     */
    domicile.cssColor = cajaVM.def(function (color) {
      // TODO: maybe whitelist the color names defined for CSS if the arg is a
      // string.
      if ('number' !== typeof color || (color != (color | 0))) {
        throw new Error(color);
      }
      var hex = '0123456789abcdef';
      return '#' + hex.charAt((color >> 20) & 0xf)
          + hex.charAt((color >> 16) & 0xf)
          + hex.charAt((color >> 12) & 0xf)
          + hex.charAt((color >> 8) & 0xf)
          + hex.charAt((color >> 4) & 0xf)
          + hex.charAt(color & 0xf);
    });
    domicile.cssUri = cajaVM.def(function (uri, mimeType) {
      var s = rewriteAttribute(null, null, html4.atype.URI, uri);
      if (!s) { throw new Error(); }
      return s;
    });

    /**
     * Create a CSS stylesheet with the given text and append it to the DOM.
     * @param {string} cssText a well-formed stylesheet production.
     */
    domicile.emitCss = cajaVM.def(function (cssText) {
      this.getCssContainer().appendChild(
          bridal.createStylesheet(document, cssText));
    });
    /** The node to which gadget stylesheets should be added. */
    domicile.getCssContainer = cajaVM.def(function () {
      var e = document.getElementsByTagName('head')[0];
      makeDOMAccessible(e);
      return e;
    });

    if (!/^-/.test(idSuffix)) {
      throw new Error('id suffix "' + idSuffix + '" must start with "-"');
    }
    if (!/___$/.test(idSuffix)) {
      throw new Error('id suffix "' + idSuffix + '" must end with "___"');
    }
    var idClass = idSuffix.substring(1);
    var idClassPattern = new RegExp(
        '(?:^|\\s)' + idClass.replace(/[\.$]/g, '\\$&') + '(?:\\s|$)');
    /** A per-gadget class used to separate style rules. */
    domicile.getIdClass = cajaVM.def(function () {
      return idClass;
    });
    // enforce id class on element
    bridal.setAttribute(pseudoBodyNode, "class",
        bridal.getAttribute(pseudoBodyNode, "class")
        + " " + idClass + " vdoc-body___");

    // bitmask of trace points
    //    0x0001 plugin_dispatchEvent
    domicile.domitaTrace = 0;
    domicile.getDomitaTrace = cajaVM.def(
        function () { return domicile.domitaTrace; }
    );
    domicile.setDomitaTrace = cajaVM.def(
        function (x) { domicile.domitaTrace = x; }
    );

    traceStartup("DT: about to do TameHTMLDocument");
    var tameDocument = new TameHTMLDocument(
        document,
        pseudoBodyNode,
        String(optPseudoWindowLocation.hostname || 'nosuchhost.invalid'),
        true);
    traceStartup("DT: finished TameHTMLDocument");
    // TODO(mikesamuel): figure out a mechanism by which the container can
    // specify the gadget's apparent URL.
    // See http://www.whatwg.org/specs/web-apps/current-work/multipage/history.html#location0
    var tameLocation = cajaVM.def({
      toString: function () { return tameLocation.href; },
      href: String(optPseudoWindowLocation.href ||
          'http://nosuchhost.invalid:80/'),
      hash: String(optPseudoWindowLocation.hash || ''),
      host: String(optPseudoWindowLocation.host || 'nosuchhost.invalid:80'),
      hostname: String(optPseudoWindowLocation.hostname ||
          'nosuchhost.invalid'),
      pathname: String(optPseudoWindowLocation.pathname || '/'),
      port: String(optPseudoWindowLocation.port || '80'),
      protocol: String(optPseudoWindowLocation.protocol || 'http:'),
      search: String(optPseudoWindowLocation.search || '')
      });

    // See spec at http://www.whatwg.org/specs/web-apps/current-work/multipage/browsers.html#navigator
    // We don't attempt to hide or abstract userAgent details since
    // they are discoverable via side-channels we don't control.
    var navigator = makeDOMAccessible(window.navigator);
    var tameNavigator = cajaVM.def({
      appName: String(navigator.appName),
      appVersion: String(navigator.appVersion),
      platform: String(navigator.platform),
      // userAgent should equal the string sent in the User-Agent HTTP header.
      userAgent: String(navigator.userAgent),
      // Custom attribute indicating Caja is active.
      cajaVersion: '1.0'
      });

    traceStartup("DT: done tameNavigator");

    /**
     * Set of allowed pseudo elements as described at
     * http://www.w3.org/TR/CSS2/selector.html#q20
     */
    var PSEUDO_ELEMENT_WHITELIST = {
      // after and before disallowed since they can leak information about
      // arbitrary ancestor nodes.
      'first-letter': true,
      'first-line': true
    };

    /**
     * See http://www.whatwg.org/specs/web-apps/current-work/multipage/browsers.html#window for the full API.
     */
    function TameWindow() {
      // These descriptors were chosen to resemble actual ES5-supporting browser
      // behavior.
      Object.defineProperty(this, "document", {
        value: tameDocument,
        configurable: false,
        enumerable: true,
        writable: false
      });
      Object.defineProperty(this, "location", {
        value: tameLocation,
        configurable: false,
        enumerable: true,
        writable: false  // Writable in browsers, but has a side-effect 
                         // which we don't implement.
      });
      Object.defineProperty(this, "navigator", {
        value: tameLocation,
        configurable: false,
        enumerable: true,
        writable: false
      });
      definePropertiesAwesomely(this, viewProperties);
      rulebreaker.permitUntaming(this);
    }
    // Methods of TameWindow are established later.
    setOwn(TameWindow.prototype, "toString", cajaVM.def(function () {
      return "[domado object Window]";
    }));

    /**
     * An <a href=
     * href=http://www.w3.org/TR/DOM-Level-2-Views/views.html#Views-AbstractView
     * >AbstractView</a> implementation that exposes styling, positioning, and
     * sizing information about the current document's pseudo-body.
     * <p>
     * The AbstractView spec specifies very little in its IDL description, but
     * mozilla defines it thusly:<blockquote>
     *   document.defaultView is generally a reference to the window object
     *   for the document, however that is not defined in the specification
     *   and can't be relied upon for all host environments, particularly as
     *   not all browsers implement it.
     * </blockquote>
     * <p>
     * We can't provide access to the tamed window directly from document
     * since it is the global scope of valija code, and so access to another
     * module's tamed window provides an unbounded amount of authority.
     * <p>
     * Instead, we expose styling, positioning, and sizing properties
     * via this class.  All of this authority is already available from the
     * document.
     */
    function TameDefaultView() {
      // TODO(kpreid): The caller passes document's editable flag; this does not
      // take such a parameter. Which is right?
      // TODO(mikesamuel): Implement in terms of
      //     http://www.w3.org/TR/cssom-view/#the-windowview-interface
      // TODO: expose a read-only version of the document
      this.document = tameDocument;
      // Exposing an editable default view that pointed to a read-only
      // tameDocument via document.defaultView would allow escalation of
      // authority.
      assert(np(tameDocument).editable);
      definePropertiesAwesomely(this, viewProperties);
      rulebreaker.permitUntaming(this);
    }
    
    tameSetAndClear(
        TameWindow.prototype,
        window.setTimeout, window.clearTimeout,
        'setTimeout', 'clearTimeout');
    tameSetAndClear(
        TameWindow.prototype,
        window.setInterval, window.clearInterval,
        'setInterval', 'clearInterval');
    TameWindow.prototype.addEventListener = cajaVM.def(
        function (name, listener, useCapture) {
      if (name === 'load') {
        domitaModules.ensureValidCallback(listener);
        np(tameDocument).onLoadListeners.push(listener);
      } else {
        // TODO: need a testcase for this
        tameDocument.addEventListener(name, listener, useCapture);
      }
    });
    TameWindow.prototype.removeEventListener = cajaVM.def(
        function (name, listener, useCapture) {
      if (name === 'load') {
        var listeners = np(tameDocument).onLoadListeners;
        var k = 0;
        for (var i = 0, n = listeners.length; i < n; ++i) {
          listeners[i - k] = listeners[+i];
          if (listeners[+i] === listener) {
            ++k;
          }
        }
        listeners.length -= k;
      } else {
        tameDocument.removeEventListener(name, listener, useCapture);
      }
    });
    TameWindow.prototype.dispatchEvent = cajaVM.def(function (evt) {
      // TODO(ihab.awad): Implement
    });
    forOwnKeys({
      scrollBy: cajaVM.def(
          function (dx, dy) {
            // The window is always auto scrollable, so make the apparent window
            // body scrollable if the gadget tries to scroll it.
            if (dx || dy) {
              makeScrollable(np(tameDocument).feralPseudoBodyNode);
            }
            tameScrollBy(np(tameDocument).feralPseudoBodyNode, dx, dy);
          }),
      scrollTo: cajaVM.def(
          function (x, y) {
            // The window is always auto scrollable, so make the apparent window
            // body scrollable if the gadget tries to scroll it.
            makeScrollable(np(tameDocument).feralPseudoBodyNode);
            tameScrollTo(np(tameDocument).feralPseudoBodyNode, x, y);
          }),
      resizeTo: cajaVM.def(
          function (w, h) {
            tameResizeTo(np(tameDocument).feralPseudoBodyNode, w, h);
          }),
      resizeBy: cajaVM.def(
          function (dw, dh) {
            tameResizeBy(np(tameDocument).feralPseudoBodyNode, dw, dh);
          }),
      /** A partial implementation of getComputedStyle. */
      getComputedStyle: cajaVM.def(
          // Pseudo elements are suffixes like :first-line which constrain to
          // a portion of the element's content as defined at
          // http://www.w3.org/TR/CSS2/selector.html#q20
          function (tameElement, pseudoElement) {
            tameElement = TameNodeT.coerce(tameElement);
            // Coerce all nullish values to undefined, since that is the value
            // for unspecified parameters.
            // Per bug 973: pseudoElement should be null according to the
            // spec, but mozilla docs contradict this.
            // From https://developer.mozilla.org/En/DOM:window.getComputedStyle
            //     pseudoElt is a string specifying the pseudo-element to match.
            //     Should be an empty string for regular elements.
            pseudoElement = (pseudoElement === null || pseudoElement === void 0
                             || '' === pseudoElement)
                ? void 0 : String(pseudoElement).toLowerCase();
            if (pseudoElement !== void 0
                && !PSEUDO_ELEMENT_WHITELIST.hasOwnProperty(pseudoElement)) {
              throw new Error('Bad pseudo element ' + pseudoElement);
            }
            // No need to check editable since computed styles are readonly.
            return new TameComputedStyle(
                np(tameElement).feral,
                pseudoElement);
          })

      // NOT PROVIDED
      // event: a global on IE.  We always define it in scopes that can handle
      //        events.
      // opera: defined only on Opera.
    }, (function (propertyName, value) {
      TameWindow.prototype[propertyName] = value;
      TameDefaultView.prototype[propertyName] = value;
    }));
    cajaVM.def(TameWindow);  // and its prototype
    
    var tameWindow = new TameWindow();
    var tameDefaultView = new TameDefaultView(np(tameDocument).editable);
    
    forOwnKeys({
      innerHeight: function () {
          return np(tameDocument).feralPseudoBodyNode.clientHeight; },
      innerWidth:  function () {
          return np(tameDocument).feralPseudoBodyNode.clientWidth; },
      outerHeight: function () {
          return np(tameDocument).feralPseudoBodyNode.clientHeight; },
      outerWidth:  function () {
          return np(tameDocument).feralPseudoBodyNode.clientWidth; }
    }, function (propertyName, handler) {
      // TODO(mikesamuel): define on prototype.
      var desc = {enumerable: canHaveEnumerableAccessors, get: handler};
      Object.defineProperty(tameWindow, propertyName, desc);
      Object.defineProperty(tameDefaultView, propertyName, desc);
    });
    
    // Attach reflexive properties to 'window' object
    var windowProps = ['top', 'self', 'opener', 'parent', 'window'];
    var wpLen = windowProps.length;
    for (var i = 0; i < wpLen; ++i) {
      var prop = windowProps[+i];
      tameWindow[prop] = tameWindow;
    }
    
    Object.freeze(tameDefaultView);
    
    if (np(tameDocument).editable) {
      tameDocument.defaultView = tameDefaultView;
      
      // Hook for document.write support.
      domicile.sanitizeAttrs = sanitizeAttrs;
    }

    // Iterate over all node classes, assigning them to the Window object
    // under their DOM Level 2 standard name. Also freeze.
    for (var name in nodeClasses) {
      var ctor = nodeClasses[name];
      cajaVM.def(ctor);  // and its prototype
      cajaVM.def(ctor.prototype);
      Object.defineProperty(tameWindow, name, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: ctor
      });
    }
    
    // TODO(ihab.awad): Build a more sophisticated virtual class hierarchy by
    // creating a table of actual subclasses and instantiating tame nodes by
    // table lookups. This will allow the client code to see a truly consistent
    // DOM class hierarchy.
    
    // This is a list of all HTML-specific element node classes defined by
    // DOM Level 2 HTML, <http://www.w3.org/TR/DOM-Level-2-HTML/html.html>.
    // If a node class name in this list is not defined using defineElement or
    // inertCtor above, then it will now be bound to the HTMLElement class.
    var allDomNodeClasses = [
      'HTMLAnchorElement',
      'HTMLAppletElement',
      'HTMLAreaElement',
      'HTMLBaseElement',
      'HTMLBaseFontElement',
      'HTMLBodyElement',
      'HTMLBRElement',
      'HTMLButtonElement',
      'HTMLDirectoryElement',
      'HTMLDivElement',
      'HTMLDListElement',
      'HTMLFieldSetElement',
      'HTMLFontElement',
      'HTMLFormElement',
      'HTMLFrameElement',
      'HTMLFrameSetElement',
      'HTMLHeadElement',
      'HTMLHeadingElement',
      'HTMLHRElement',
      'HTMLHtmlElement',
      'HTMLIFrameElement',
      'HTMLImageElement',
      'HTMLInputElement',
      'HTMLIsIndexElement',
      'HTMLLabelElement',
      'HTMLLegendElement',
      'HTMLLIElement',
      'HTMLLinkElement',
      'HTMLMapElement',
      'HTMLMenuElement',
      'HTMLMetaElement',
      'HTMLModElement',
      'HTMLObjectElement',
      'HTMLOListElement',
      'HTMLOptGroupElement',
      'HTMLOptionElement',
      'HTMLParagraphElement',
      'HTMLParamElement',
      'HTMLPreElement',
      'HTMLQuoteElement',
      'HTMLScriptElement',
      'HTMLSelectElement',
      'HTMLStyleElement',
      'HTMLTableCaptionElement',
      'HTMLTableCellElement',
      'HTMLTableColElement',
      'HTMLTableElement',
      'HTMLTableRowElement',
      'HTMLTableSectionElement',
      'HTMLTextAreaElement',
      'HTMLTitleElement',
      'HTMLUListElement'
    ];

    var defaultNodeClassCtor = nodeClasses.HTMLElement;
    for (var i = 0; i < allDomNodeClasses.length; i++) {
      var className = allDomNodeClasses[+i];
      if (!(className in tameWindow)) {
        Object.defineProperty(tameWindow, className, {
          enumerable: true,
          configurable: true,
          writable: true,
          value: defaultNodeClassCtor
        });
      }
    }
    
    tameDocument = finishNode(tameDocument);
    
    domicile.window = tameWindow;
    domicile.document = tameDocument;
    
    pluginId = rulebreaker.getId(tameWindow);
    windowToDomicile.set(tameWindow, domicile);

    traceStartup("DT: all done");
    
    return domicile;
  }

  /**
   * Function called from rewritten event handlers to dispatch an event safely.
   */
  function plugin_dispatchEvent(thisNode, event, pluginId, handler) {
    event = makeDOMAccessible(event || bridalMaker.getWindow(thisNode).event);
    // support currentTarget on IE[678]
    if (!event.currentTarget) {
      event.currentTarget = thisNode;
    }
    var domicile = windowToDomicile.get(rulebreaker.getImports(pluginId));
    var node = domicile.tameNode(thisNode, true);
    return plugin_dispatchToHandler(
        pluginId, handler, [ node, domicile.tameEvent(event), node ]);
  }

  function plugin_dispatchToHandler(pluginId, handler, args) {
    var sig = ('' + handler).match(/^function\b[^\)]*\)/);
    var domicile = windowToDomicile.get(rulebreaker.getImports(pluginId));
    if (domicile.domitaTrace & 0x1 && typeof console != 'undefined') {
      console.log(
          'Dispatch pluginId=' + pluginId +
          ', handler=' + (sig ? sig[0] : handler) +
          ', args=' + args);
    }
    switch (typeof handler) {
      case 'number':
        handler = domicile.handlers[+handler];
        break;
      case 'string':
        var fn = void 0;
        var tameWin = void 0;
        fn = domicile.imports.window[handler];
        handler = fn && typeof fn.call === 'function' ? fn : void 0;
        break;
      case 'function': case 'object': break;
      default:
        throw new Error(
            'Expected function as event handler, not ' + typeof handler);
    }
    domicile.isProcessingEvent = true;
    try {
      return handler.call.apply(handler, args);
    } catch (ex) {
      // guard against IE discarding finally blocks
      throw ex;
    } finally {
      domicile.isProcessingEvent = false;
    }
  }
  
  return cajaVM.def({
    attachDocument: attachDocument,
    plugin_dispatchEvent: plugin_dispatchEvent,
    plugin_dispatchToHandler: plugin_dispatchToHandler,
    getDomicileForWindow: windowToDomicile.get.bind(windowToDomicile)
  });
}
