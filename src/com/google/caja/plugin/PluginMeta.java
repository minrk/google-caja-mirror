// Copyright (C) 2006 Google Inc.
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

package com.google.caja.plugin;

import com.google.caja.precajole.PrecajoleMap;
import com.google.caja.precajole.StaticPrecajoleMap;

import javax.annotation.Nullable;

/**
 * For a plugin, determines how its external dependencies are translated.
 */
public final class PluginMeta {
  /** Used to generate names that are unique within the plugin's namespace. */
  private int guidCounter;
  private final UriFetcher uriFetcher;
  private final @Nullable UriPolicy uriPolicy;
  /**
   * The DOM ID suffix if known at Cajole time.  Most clients should allow the
   * module ID to be assigned dynamically but for those clients who know that
   * they can avoid overlaps.
   */
  private @Nullable String idClass;

  private PrecajoleMap precajoleMap = null;
  private boolean precajoleMinify = false;

  public PluginMeta() {
    this(UriFetcher.NULL_NETWORK, UriPolicy.DENY_ALL);
  }

  public PluginMeta(UriFetcher uriFetcher, @Nullable UriPolicy uriPolicy) {
    // Use default precajoleMap, so oblivious callers can benefit
    this(uriFetcher, uriPolicy, StaticPrecajoleMap.getInstance(), false);
  }

  public PluginMeta(
      UriFetcher uriFetcher, @Nullable UriPolicy uriPolicy,
      @Nullable PrecajoleMap precajoleMap, boolean precajoleMinify) {
    if (uriFetcher == null) {
      throw new NullPointerException();
    }
    this.uriFetcher = uriFetcher;
    this.uriPolicy = uriPolicy;
    this.precajoleMap = precajoleMap;
    this.precajoleMinify = precajoleMinify;
  }

  /**
   * Generates a name that can be used as an identifier in the plugin's
   * namespace.
   * @param prefix a valid javascript identifier prefix.
   */
  public String generateUniqueName(String prefix) {
    return prefix + "_" + (++guidCounter) + "___";
  }

  public int generateGuid() { return ++guidCounter; }

  /** Describes how resources external to the plugin definition are resolved. */
  public @Nullable UriPolicy getUriPolicy() { return uriPolicy; }

  /** Describes how resources external to the plugin definition are resolved. */
  public UriFetcher getUriFetcher() { return uriFetcher; }

  /**
   * {@code null} if the module ID is not known statically.
   * See {@code imports.getIdClass___()} defined in "domita.js".
   */
  public @Nullable String getIdClass() { return idClass; }

  public void setIdClass(@Nullable String idClass) { this.idClass = idClass; }

  public void setPrecajoleMap(PrecajoleMap map) {
    precajoleMap = map;
  }

  public PrecajoleMap getPrecajoleMap() {
    return precajoleMap;
  }

  public void setPrecajoleMinify(boolean value) {
    precajoleMinify = value;
  }

  public boolean getPrecajoleMinify() {
    return precajoleMinify;
  }
}
