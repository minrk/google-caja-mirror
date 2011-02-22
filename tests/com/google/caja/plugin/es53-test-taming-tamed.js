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

  caja.configure({
    cajaServer: 'http://localhost:8000/caja',
    debug: true
  }, function (frameGroup) {

    // An object that will contain our tamed API.
    var api = {};

    ////////////////////////////////////////////////////////////////////////
    // TEST OBJECT FOR PROBING THE TAMING

    var testObject = {};

    var getFeralTestObject = function() {
      return testObject;
    };
    var getTamedTestObject = function() {
      frameGroup.tame(testObject);  // Ensure done if not already
      return testObject.TAMED_TWIN___;
    };
    getFeralTestObject.i___ = getFeralTestObject;
    getTamedTestObject.i___ = getTamedTestObject;

    ////////////////////////////////////////////////////////////////////////
    // ACCESS TO OBJECTS IN TAMING FRAME

    var getTamingFrameObject = function(key) {
      key = '' + key;
      return frameGroup.iframe.contentWindow[key];
    };
    getTamingFrameObject.i___ = getTamingFrameObject;

    ////////////////////////////////////////////////////////////////////////
    // READ ONLY RECORDS

    api.readOnlyRecord = {
      x: 42,
      17: 'seventeen',
      toxicFunctionProperty: function() {}
    };
    api.setReadOnlyRecordField = function(k, v) {
      api.readOnlyRecord[k] = v;
    };

    frameGroup.markFunction(api.setReadOnlyRecordField,
        'setReadOnlyRecordField');
    frameGroup.markReadOnlyRecord(api.readOnlyRecord);

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

    frameGroup.markFunction(api.setArrayField, 'setArrayField');

    ////////////////////////////////////////////////////////////////////////
    // READ WRITE RECORDS

    api.readWriteRecord = {
      x: 42,
      17: 'seventeen',
      toxicFunctionProperty: function() {}
    };
    api.setReadWriteRecordField = function(k, v) {
      api.readWriteRecord[k] = v;
    };

    frameGroup.markFunction(api.setReadWriteRecordField,
        'setReadWriteRecordField');

    ////////////////////////////////////////////////////////////////////////
    // FUNCTIONS RETURNING PRIMITIVES

    api.functionReturningPrimitive = function (x) {
      return x + 42;
    };

    frameGroup.markFunction(api.functionReturningPrimitive,
        'functionReturningPrimitive');

    ////////////////////////////////////////////////////////////////////////
    // CONSTRUCTORS

    // Create a "class and subclass" pair of constructors
    api.Ctor = function Ctor(x) {
      this.x = x;
      this.invisibleProperty = 17;
      this.readOnlyProperty = 19;
      this.readWriteProperty = 23;
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
    api.Ctor.prototype.readOnlyProperty = 3;
    api.Ctor.prototype.readWriteProperty = 7;

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
    frameGroup.markCtor(api.Ctor, Object, 'Ctor');
    frameGroup.markCtor(api.SubCtor, api.Ctor, 'SubCtor');
    frameGroup.grantMethod(api.Ctor, 'getX');
    frameGroup.grantMethod(api.Ctor, 'setX');
    frameGroup.grantMethod(api.SubCtor, 'getY');
    frameGroup.grantMethod(api.SubCtor, 'setY');
    frameGroup.grantMethod(api.SubCtor, 'getMagSquared');

    frameGroup.grantRead(api.Ctor.prototype, 'readOnlyProperty');
    frameGroup.grantReadWrite(api.Ctor.prototype, 'readWriteProperty');

    frameGroup.markFunction(api.functionReturningConstructed,
        'functionReturningConstructed');

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
    // VARIOUS KINDS OF FUNCTIONSectly

    api.functionReturningRecord = function (x) {
      return {
        x: x,
      };
    };
    api.functionReturningFunction = function (x) {
      return frameGroup.markFunction(function (y) { return x + y; });
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

    frameGroup.markFunction(api.functionReturningRecord,
        'functionReturningRecord');
    frameGroup.markFunction(api.functionReturningFunction,
        'functionReturningFunction');
    frameGroup.markFunction(api.functionCallingMyFunction,
        'functionCallingMyFunction');
    frameGroup.markFunction(api.functionReturningMyFunction,
        'functionReturningMyFunction');
    frameGroup.markFunction(api.pureFunctionReturningThis,
        'pureFunctionReturningThis');

    ////////////////////////////////////////////////////////////////////////
    // IDENTITY FUNCTION

    api.identity = function(x) {
      return x;
    };

    frameGroup.markFunction(api.identity, 'identity');

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

    frameGroup.markXo4a(api.xo4aUsingThis, 'xo4aUsingThis');
    frameGroup.markXo4a(api.xo4aReturningThis, 'xo4aReturningThis');

    ////////////////////////////////////////////////////////////////////////
    // PROPERTIES ON FUNCTIONS

    api.functionWithProperties = function (x) {
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

    frameGroup.markFunction(api.functionWithProperties,
        'functionWithProperties');
    frameGroup.grantRead(api.functionWithProperties, 'readOnlyProperty');
    frameGroup.grantReadWrite(api.functionWithProperties, 'readWriteProperty');
    frameGroup.markFunction(api.setReadOnlyPropertyOnFunction,
         'setReadOnlyPropertyOnFunction');

    ////////////////////////////////////////////////////////////////////////

    frameGroup.markReadOnlyRecord(api);

    // Set up basic stuff

    var div = createDiv();
    function uriCallback(uri, mimeType) { return uri; }

    // Invoke cajoled tests, passing in the tamed API

    frameGroup.makeES5Frame(div, uriCallback, function (frame) {
      var extraImports = createExtraImportsForTesting(frameGroup, frame);
      
      extraImports.tamedApi = frameGroup.tame(api);

      extraImports.tamingFrameUSELESS =
          frameGroup.iframe.contentWindow.___.USELESS;

      extraImports.tamingFrameObject =
          frameGroup.iframe.contentWindow.Object;
      extraImports.tamingFrameFunction =
          frameGroup.iframe.contentWindow.Function;
      extraImports.tamingFrameArray =
          frameGroup.iframe.contentWindow.Array;

      extraImports.getFeralTestObject = getFeralTestObject;
      extraImports.getTamedTestObject = getTamedTestObject;

      extraImports.getTamingFrameObject = getTamingFrameObject;

      extraImports.evalInHost = function(s) {
        return eval(String(s));
      };
      extraImports.evalInHost.i___ = extraImports.evalInHost;
      
      frame.run('es53-test-taming-tamed-cajoled.html', extraImports,
          function (_) {
            readyToTest();
            jsunitRun();
          });
    });
  });
})();
