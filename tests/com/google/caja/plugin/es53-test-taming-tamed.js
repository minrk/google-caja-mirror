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
 * @fileoverview ES53 tests of taming host objects for use by guest.
 *
 * @author ihab.awad@gmail.com
 * @requires caja, jsunitRun, readyToTest
 */

(function () {

  caja.initialize({
    cajaServer: '/caja',
    debug: true,
    forceES5Mode: inES5Mode
  });

  // Set up basic stuff

  var div = createDiv();
  var uriPolicy = {
    rewrite: function (uri, uriEffect, loaderType, hints) { return uri; }
  };

  caja.load(div, uriPolicy, function (frame) {

    // An object that will contain our tamed API.
    var api = {};

    ////////////////////////////////////////////////////////////////////////
    // ACCESS TO OBJECTS IN TAMING FRAME

    var getTamingFrameObject = function(expr) {
      expr = '' + expr;
      return caja.iframe.contentWindow.eval(expr);
    };
    getTamingFrameObject.i___ = getTamingFrameObject;

    ////////////////////////////////////////////////////////////////////////
    // READ ONLY RECORDS

    api.readOnlyRecord = {
      x: 42,
      17: 'seventeen',
      toxicFunctionProperty: function() {},
      xo4aTestValue: 19,
      __proto__: 42
    };
    api.setReadOnlyRecordField = function(k, v) {
      api.readOnlyRecord[k] = v;
    };

    frame.markFunction(api.setReadOnlyRecordField,
        'setReadOnlyRecordField');
    frame.markReadOnlyRecord(api.readOnlyRecord);

    ////////////////////////////////////////////////////////////////////////
    // ARRAYS

    api.array = [
      42
    ];
    api.setArrayField = function(i, v) {
      api.array[i] = v;
    };

    // Put a reference to some otherwise well-known nonprimitive in an
    // array, to be sure that this gets tamed properly by the array taming.
    api.array[1] = api.readOnlyRecord;

    frame.markFunction(api.setArrayField, 'setArrayField');

    ////////////////////////////////////////////////////////////////////////
    // READ WRITE RECORDS

    api.readWriteRecord = {
      x: 42,
      17: 'seventeen',
      toxicFunctionProperty: function() {},
      __proto__: 42
    };
    api.setReadWriteRecordField = function(k, v) {
      api.readWriteRecord[k] = v;
    };

    frame.markFunction(api.setReadWriteRecordField,
        'setReadWriteRecordField');

    ////////////////////////////////////////////////////////////////////////
    // FUNCTIONS RETURNING PRIMITIVES

    api.functionReturningPrimitive = function (x) {
      return x + 42;
    };

    frame.markFunction(api.functionReturningPrimitive,
        'functionReturningPrimitive');

    ////////////////////////////////////////////////////////////////////////
    // CONSTRUCTORS

    // Create a "class and subclass" pair of constructors
    api.Ctor = function Ctor(x) {
      if (!(this instanceof Ctor)) { return "Called as function"; }
      this.x = x;
      this.invisibleProperty = 17;
      this.readOnlyProperty = 19;
      this.readWriteProperty = 23;
    };
    api.Ctor.staticFunction = function(x) {
      return x + 17;
    };
    api.Ctor.prototype.getX = function () {
      return this.x;
    };
    api.Ctor.prototype.setX = function (x) {
      this.x = x;
    };
    api.Ctor.prototype.toxicFunctionProperty = function(x) {
      return "poison";
    };
    api.Ctor.prototype.xo4aTestMethod = function(v) {
      this.xo4aTestValue = v;
    };
    api.Ctor.prototype.readWriteMethod = function(x) {
      this.x = '' + x + 'readWriteMethod';
    };
    api.Ctor.prototype.readOverrideMethod = function(x) {
      this.x = '' + x + 'readOverrideMethod';
    };
    api.Ctor.prototype.readOnlyProperty = 3;
    api.Ctor.prototype.readWriteProperty = 7;
    api.Ctor.prototype.readOverrideProperty = 11;

    api.SubCtor = function SubCtor(x, y) {
      api.Ctor.call(this, x);
      this.y = y;
    }
    api.SubCtor.prototype = new api.Ctor(0);
    api.SubCtor.prototype.constructor = api.SubCtor;
    api.SubCtor.prototype.getY = function () {
      return this.y;
    };
    api.SubCtor.prototype.setY = function (y) {
      this.y = y;
    };
    api.SubCtor.prototype.getMagSquared = function () {
      return this.x * this.x + this.y * this.y;
    };
    api.SubCtor.prototype.toxicSubMethod = function() {
      return "poison";
    };

    api.functionReturningConstructed = function (x) {
      return new api.Ctor(x);
    };

    // Whitelist the 'Ctor' and 'SubCtor' as constructors, and whitelist the
    // methods except the 'toxic' ones.

    frame.grantRead(api.Ctor, 'prototype');

    frame.grantRead(api.Ctor, 'staticFunction');
    frame.markFunction(api.Ctor.staticFunction);

    frame.grantMethod(api.Ctor.prototype, 'getX');
    frame.grantMethod(api.Ctor.prototype, 'setX');
    frame.grantMethod(api.Ctor.prototype, 'xo4aTestMethod');
    frame.grantMethod(api.Ctor.prototype, 'readWriteMethod');
    frame.grantMethod(api.Ctor.prototype, 'readOverrideMethod');
    frame.grantRead(api.Ctor.prototype, 'readOnlyProperty');
    frame.grantReadWrite(api.Ctor.prototype, 'readWriteProperty');
    frame.grantReadWrite(api.Ctor.prototype, 'readWriteMethod');
    frame.grantReadOverride(api.Ctor.prototype, 'readOverrideProperty');
    frame.grantReadOverride(api.Ctor.prototype, 'readOverrideMethod');

    frame.markCtor(api.Ctor, Object, 'Ctor');

    frame.grantMethod(api.SubCtor.prototype, 'getY');
    frame.grantMethod(api.SubCtor.prototype, 'setY');
    frame.grantMethod(api.SubCtor.prototype, 'getMagSquared');

    frame.markCtor(api.SubCtor, api.Ctor, 'SubCtor');

    frame.markFunction(api.functionReturningConstructed,
        'functionReturningConstructed');

    // Create a "wrong" constructor that we do not whitelist

    WrongCtor = function WrongCtor(x) { };

    api.functionReturningWrongConstructed = function (x) {
      return new WrongCtor(x);
    };

    // Whitelist the function returning the "wrong" constructed object

    frame.markFunction(api.functionReturningWrongConstructed,
        'functionReturningWrongConstructed');

   ////////////////////////////////////////////////////////////////////////
    // TOXIC CONSTRUCTORS

    // Create a "class and subclass" pair of constructors that we will ensure
    // the guest code cannot use, even though it can read them.
    api.ToxicCtor = function(x) {
      this.x = x;
    }
    api.ToxicCtor.prototype.getX = function() {
      return this.x;
    };
    api.ToxicSubCtor = function(x, y) {
      api.ToxicCtor.call(this, x);
      this.y = y;
    }
    api.ToxicSubCtor.prototype = new api.ToxicCtor(0);
    api.ToxicSubCtor.prototype.getY = function() {
      return this.y;
    };

    ////////////////////////////////////////////////////////////////////////
    // VARIOUS KINDS OF FUNCTIONS

    api.functionReturningRecord = function (x) {
      return {
        x: x
      };
    };
    api.functionReturningFunction = function (x) {
      return frame.markFunction(function (y) { return x + y; });
    };
    api.functionCallingMyFunction = function (f, x) {
      return f(x);
    };
    api.functionReturningMyFunction = function (f) {
      return f;
    };
    api.pureFunctionReturningThis = function () {
      return this;
    };

    frame.markFunction(api.functionReturningRecord,
        'functionReturningRecord');
    frame.markFunction(api.functionReturningFunction,
        'functionReturningFunction');
    frame.markFunction(api.functionCallingMyFunction,
        'functionCallingMyFunction');
    frame.markFunction(api.functionReturningMyFunction,
        'functionReturningMyFunction');
    frame.markFunction(api.pureFunctionReturningThis,
        'pureFunctionReturningThis');

    ////////////////////////////////////////////////////////////////////////
    // IDENTITY FUNCTION

    api.identity = function(x) {
      return x;
    };

    frame.markFunction(api.identity, 'identity');

    ////////////////////////////////////////////////////////////////////////
    // TOXIC FUNCTIONS

    api.toxicFunction = function() {
      return "poison";
    };

    ////////////////////////////////////////////////////////////////////////
    // EXOPHORIC FUNCTIONS

    api.xo4aUsingThis = function(y) {
      return this.x + y;
    };
    api.xo4aReturningThis = function() {
      return this;
    };

    frame.markXo4a(api.xo4aUsingThis, 'xo4aUsingThis');
    frame.markXo4a(api.xo4aReturningThis, 'xo4aReturningThis');

    ////////////////////////////////////////////////////////////////////////
    // PROPERTIES ON FUNCTIONS

    api.functionWithProperties = function functionWithProperties(x) {
      return x;
    };

    api.functionWithProperties.invisibleProperty = 17;
    api.functionWithProperties.readOnlyProperty = 33;
    api.functionWithProperties.readWriteProperty = 49;
    api.functionWithProperties[17] = 'seventeen';
    api.functionWithProperties.toxicFunctionProperty = function() {};

    api.setReadOnlyPropertyOnFunction = function (x) {
      api.functionWithProperties.readOnlyProperty = x;
    };

    frame.grantRead(api.functionWithProperties, 'readOnlyProperty');
    frame.grantReadWrite(api.functionWithProperties, 'readWriteProperty');
    frame.markFunction(api.functionWithProperties,
        'functionWithProperties');
    frame.markFunction(api.setReadOnlyPropertyOnFunction,
         'setReadOnlyPropertyOnFunction');

    ////////////////////////////////////////////////////////////////////////
    // TAMED eval() RESULT

    api.evalInHostTamed = function(str, a, b) {
      return eval(str);
    }

    frame.markFunction(api.evalInHostTamed, 'evalInHostTamed');

    ////////////////////////////////////////////////////////////////////////
    // Object with getters and setters that throw

    api.objWithThrowingAccessors = {};

    if (inES5Mode) {
      // Define a custom exception type that does not have a taming
      function CustomException(msg) { this.msg = msg; }
      CustomException.prototype.constructor = CustomException;
      CustomException.prototype.toString = function() {
        return 'CustomException: ' + this.msg;
      };

      Object.defineProperty(api.objWithThrowingAccessors, 'throwingProp', {
        get: function() {
          throw new CustomException('getter threw');
        },
        set: function(v) {
          throw new CustomException('setter threw');
        },
        enumerable: true
      });
    }

    ////////////////////////////////////////////////////////////////////////

    frame.markReadOnlyRecord(api);

    // Invoke cajoled tests, passing in the tamed API

    var extraImports = createExtraImportsForTesting(caja, frame);

    extraImports.tamedApi = frame.tame(api);

    extraImports.tamingFrameUSELESS =
        frame.USELESS;

    extraImports.getTamingFrameObject = getTamingFrameObject;

    extraImports.evalInHost = function(s) {
      return eval(String(s));
    };
    extraImports.evalInHost.i___ = extraImports.evalInHost;

    frame.code('es53-test-taming-tamed-guest.html')
         .api(extraImports)
         .run(function (_) {
             readyToTest();
             jsunitRun();
           });
  });
})();
