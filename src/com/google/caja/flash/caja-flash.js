// Copyright (C) 2011 Google Inc.
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
 * @fileoverview Allows containers to mimic swfobject for cajoled gadgets
 *
 * @author felixz@gmail.com
 * @requires document
 * @overrides window
 * @provides cajaFlash
 */

var cajaFlash = {};

(function() {

  function getTaming() {
    var caja = window.parent.caja;
    return {
      tame: caja.tame,
      untame: caja.untame,
      USELESS: caja.USELESS
    };
  }

  // Get an Object with no Caja.
  var cleanFrame = document.createElement('iframe');
  var where = document.getElementsByTagName('script')[0];
  where.parentNode.insertBefore(cleanFrame, where);
  var cleanObject = cleanFrame.contentWindow.Object;
  var cleanString = cleanFrame.contentWindow.String;
  where.parentNode.removeChild(cleanFrame);

  // Convert a tame object into a clean string->string map
  function cleanStringMap(o, caja___, taming___) {
    var result = cleanObject();
    if (!o) { return result; }
    caja___.forOwnKeys(o, function(key, value) {
      result[cleanString(key)] = cleanString(value);
    });
    return result;
  }

  function cleanAttrs(o, caja___, taming___) {
    var result = cleanStringMap(o, caja___, taming___);
    // TODO(felix8a): attributes need more than just cleaning
    return cleanObject();
  }

  // Return a function that throws "not implemented yet".
  function unimp(o, name) {
    o[name] = function() {
      throw Error(name + ' is not implemented yet.');
    };
  }

  // Given two version strings, return the higher version.
  function versionMax(a, b) {
    if (!a) { return b; }
    if (!b) { return a; }
    var av = a.split(/[.]/);
    var bv = b.split(/[.]/);
    var n = Math.min(av.length, bv.length);
    for (var i = 0; i < n; i++) {
      var avi = +av[i];
      var bvi = +bv[i];
      if (avi < bvi) {
        return b;
      } else if (bvi < avi) {
        return a;
      }
    }
    return (av.length < bv.length) ? b : a;
  }

  function initCallbacks(docWin, guestImps, tamingWin, domicile) {
    if (!docWin.caja) {
      docWin.caja = docWin.Object();
    }
    if (!docWin.caja.policy) {
      docWin.caja.policy = docWin.Object();
    }
    if (!docWin.caja.policy.flash) {
      docWin.caja.policy.flash = docWin.Object();
    }
    var docFlash = docWin.caja.policy.flash;

    var caja___ = tamingWin.___;
    var taming___ = getTaming();

    // Map from context id (integer) to swf object.
    docFlash.objects = docWin.Array();

    // Called when bridge finishes loading target swf.
    docFlash.onLoaderInit = function onLoaderInit(context) {};

    // Called when bridge fails to load target swf.
    docFlash.onLoaderError = function onLoaderError(context) {};

    // Called to service ExternalInterface.addCallback()
    docFlash.onAddCallback = function onAddCallback(context, fnName) {
      var m = /^caja_(\w+)/.exec(fnName);
      if (!m) {
        throw Error('bad function name ' + fnName);
      }
      var baseFnName = m[1];
      var obj = docFlash.objects[context];
      if (!obj || !obj[fnName]) {
        throw Error('bad context ' + context);
      }
      var el = domicile.tameNode(obj, true);
      if (!el) {
        throw Error("Can't tame " + obj);
      }
      el[baseFnName] = function (varargs) {
        var args = Array.prototype.slice.call(arguments);
        var result = obj[fnName].apply(obj, taming___.untame(args));
        return taming___.tame(result);
      };
      caja___.markFuncFreeze(el[baseFnName], baseFnName);
      if (!caja___.canRead(el, baseFnName)) {
        caja___.grantRead(el, baseFnName);
      }
    };

    // Called to service ExternalInterface.call()
    docFlash.onCall = function onCall(context, fnName, args) {
      var fn = (guestImps.window && guestImps.window[fnName])
          || guestImps[fnName];
      if (!caja___.isFunction(fn)) { return void 0; }
      var result = fn.f___(taming___.USELESS, taming___.tame(args));
      return taming___.untame(result);
    };

    // Called to service flash.net.navigateToURL()
    docFlash.onNavigateToURL = function onNavigateToURL(context, req) {
      if (!guestImps.rewriteUriInAttribute___) {
        throw Error('No URI rewriter');
      }
      // TODO(felix8a): maybe use domicile.rewriteUri (which doesn't work)
      var rewritten = guestImps.rewriteUriInAttribute___(req.url, 'a', 'href');
      if (!rewritten) {
        throw Error('URI policy denied ' + req.url);
      }
      if (!window.open(rewritten, '_blank')) {
        throw Error('Failed to open ' + rewritten);
      }
    };
  }

  // http://code.google.com/p/swfobject/wiki/api
  // http://code.google.com/p/swfobject/source/browse/wiki/api.wiki?r=383
  function initSwfobject(docWin, guestImps, tamingWin, domicile) {
    if (!docWin.swfobject) { return; }

    var caja___ = tamingWin.___;
    var taming___ = getTaming();

    var swf = guestImps.swfobject;
    if (!swf) {
      swf = guestImps.swfobject = tamingWin.Object();
      caja___.grantRead(guestImps, 'swfobject');
    }

    swf.ua = taming___.tame(docWin.swfobject.ua);

    var docFlash = docWin.caja.policy.flash;

    swf.embedSWF = function embedSWF(
      swfUrl, id, width, height, version,
      expressInstall, flashvars, params, attrs, cb)
    {
      var context = docFlash.objects.length;
      docFlash.objects[context] = docWin.Object();
      var outSwfUrl = (
        'flashbridge.swf' +
        '?__CAJA_cajaContext=' + context +
        '&__CAJA_src=' + swfUrl);
      var outId = domicile.suffix(id);
      var outWidth = +width;
      var outHeight = +height;
      var outVersion = versionMax(version, '11.3');
      var outExpressInstall = false;
      var outFlashvars = cleanStringMap(flashvars, caja___, taming___);
      var outParams = cleanStringMap(params, caja___, taming___);
      // allowNetworking=all so flashbridge can load the target swf
      outParams.allowNetworking = 'all';
      // allowScriptAccess=same-domain to allow flashbridge but not target swf
      outParams.allowScriptAccess = 'same-domain';
      // wmode=transparent makes flash honor the html visual stack
      outParams.wmode = 'transparent';
      var outAttrs = cleanAttrs(attrs, caja___, taming___);
      var outCb = function (args) {
        docFlash.objects[context] = args.ref;
        if (!caja___.isFunction(cb)) { return; }
        var tameArgs = {
          success: args.success,
          id: args.id,
          ref: domicile.tameNode(args.ref, true)
        };
        tameArgs = taming___.tame(tameArgs);
        cb.f___(taming___.USELESS, [tameArgs]);
      };
      docWin.swfobject.embedSWF(
        outSwfUrl, outId, outWidth, outHeight, outVersion,
        outExpressInstall, outFlashvars, outParams, outAttrs, outCb);
    };

    unimp(swf, 'registerObject');
    unimp(swf, 'getObjectById');
    unimp(swf, 'getFlashPlayerVersion');
    unimp(swf, 'hasFlashPlayerVersion');
    unimp(swf, 'addLoadEvent');
    unimp(swf, 'addDomLoadEvent');
    unimp(swf, 'createSWF');
    unimp(swf, 'removeSWF');
    unimp(swf, 'createCSS');
    unimp(swf, 'getQueryParamValue');
    unimp(swf, 'switchOffAutoHideShow');
    unimp(swf, 'showExpressInstall');
    caja___.whitelistAll(swf);
  }

  function findElByClass(domicile, name) {
    var nodelist = domicile.document.getElementsByClassName(name);
    return nodelist && nodelist[0] && domicile.feralNode(nodelist[0]);
  }

  // Setup functions and callbacks for tamed Flash.
  cajaFlash.init = function init(
      docWin, guestImps, tamingWin, domicile, guestWin)
  {
    initCallbacks(docWin, guestImps, tamingWin, domicile);
    initSwfobject(docWin, guestImps, tamingWin, domicile);

    // Called from html-emitter
    function cajaHandleEmbed(params) {
      var el = findElByClass(domicile, params.id);
      if (!el) { return; }

      // No src is a <noembed>
      if (!params.src) {
        el.parentNode.removeChild(el);
        return;
      }

      el.id = domicile.suffix(params.id);
      // TODO(felix8a): more args
      guestImps.swfobject.embedSWF(
        params.src, params.id, params.width, params.height);
    }

    var caja___ = tamingWin.___;
    var taming___ = getTaming();

    // called by HtmlEmitter
    guestImps.cajaHandleEmbed = cajaHandleEmbed;
    caja___.grantFunc(guestImps, 'cajaHandleEmbed');
  };
})();

// Exports for closure compiler.
if (typeof window !== 'undefined') {
  window['cajaFlash'] = cajaFlash;
}
