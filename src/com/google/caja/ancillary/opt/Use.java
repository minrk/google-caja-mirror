// Copyright (C) 2009 Google Inc.
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

package com.google.caja.ancillary.opt;

/** Encapsulates information about the use of a name, as in a reference. */
final class Use {
  final ScopeInfo definingScope;
  final String origName;

  Use(ScopeInfo definingScope, String origName) {
    this.definingScope = definingScope;
    this.origName = origName;
  }

  @Override
  public boolean equals(Object o) {
    if (!(o instanceof Use)) { return false; }
    Use that = (Use) o;
    return definingScope == that.definingScope
        && origName.equals(that.origName);
  }

  @Override
  public int hashCode() {
    return System.identityHashCode(definingScope) + 31 * origName.hashCode();
  }
}