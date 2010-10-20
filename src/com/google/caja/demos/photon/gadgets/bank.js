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
 * Mint data type.
 *
 * @param reserve a root purse containing the reserve of the bank.
 */

'use strict';
'use cajita';

// TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE
// TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE
// TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE
// TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE TODO INSECURE
// ASK erights FOR SECURE IMPL

var balanceByPurse = cajita.newTable();
var purses = load('../container/list')({});
var events = load('../container/events')({
  names: [ 'purses' ]
});

var privateNewPurse = function(balance, name) {
  cajita.enforceNat(balance);
  var purse = cajita.freeze({
    depositFrom: function(aPurse, amount) {
      if (amount === undefined) {
        amount = aPurse.getBalance();
      }
      cajita.enforceNat(amount);
      if (balanceByPurse.get(aPurse) === undefined) {
	throw 'Source is not a purse in this bank';
      }
      if (amount > balanceByPurse.get(aPurse)) {
	throw 'Source purse has inadequate funds';
      }
      cajita.enforceNat(balanceByPurse.get(purse) + amount);
      balanceByPurse.set(aPurse, balanceByPurse.get(aPurse) - amount);
      balanceByPurse.set(purse, balanceByPurse.get(purse) + amount);
      events.fire('purses');  // Hack; we don't listen to individual purses
    },
    getBalance: function() {
      return balanceByPurse.get(purse);
    },
    getName: function() {
      return name;
    },
    newPurse: function(name) {
      return privateNewPurse(0, name);
    },
    destroy: function() {
      if (balanceByPurse.get(purse) > 0) {
	throw 'Cannot destroy a nonempty purse';
      }
      balanceByPurse.set(purse, undefined);
      purses.remove(purse);
      name = undefined;
      events.fire('purses');
    }
  });
  balanceByPurse.set(purse, balance);
  purses.push(purse);
  events.fire('purses');
  return purse;
};

/* return */ cajita.freeze({
  reserve: privateNewPurse(reserve, 'Reserve'),
  purses: purses.asReadOnly,
  listen: events.listen,
  unlisten: events.unlisten
});
