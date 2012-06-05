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

package com.google.caja.demos.playground.server;

import com.google.caja.plugin.stages.JobCache;
import com.google.caja.util.Lists;
import com.google.caja.util.Sets;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.Set;

final class AppEngineJobCacheKeys implements JobCache.Keys {

  final ArrayList<AppEngineJobCacheKey> keys;

  AppEngineJobCacheKeys(AppEngineJobCacheKey key) {
    this.keys = (ArrayList<AppEngineJobCacheKey>) Lists.newArrayList(key);
  }

  private AppEngineJobCacheKeys(Iterable<? extends AppEngineJobCacheKey> keys) {
    this.keys = (ArrayList<AppEngineJobCacheKey>) Lists.newArrayList(keys);
  }

  public AppEngineJobCacheKeys union(JobCache.Keys other) {
    if (!other.iterator().hasNext()) { return this; }
    AppEngineJobCacheKeys that = (AppEngineJobCacheKeys) other;
    Set<AppEngineJobCacheKey> allKeys = Sets.newLinkedHashSet();
    allKeys.addAll(this.keys);
    allKeys.addAll(that.keys);
    if (allKeys.size() == this.keys.size()) { return this; }
    if (allKeys.size() == that.keys.size()) { return that; }
    return new AppEngineJobCacheKeys(allKeys);
  }

  @Override
  public boolean equals(Object o) {
    return o instanceof AppEngineJobCacheKeys &&
      keys.equals(((AppEngineJobCacheKeys) o).keys);
  }

  @Override
  public int hashCode() {
    return keys.hashCode();
  }

  public Iterator<JobCache.Key> iterator() {
    return Lists.<JobCache.Key>newArrayList(keys).iterator();
  }
}
