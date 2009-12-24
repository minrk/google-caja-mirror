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

package com.google.caja.ancillary.servlet;

import com.google.caja.util.ContentType;

/**
 * Encapsulates a source file uploaded to the tools servlet.
 *
 * @author mikesamuel@gmail.com
 */
final class Input {
  final ContentType t;
  final String path;
  final String code;

  Input(ContentType t, String path, String code) {
    this.t = t;
    this.path = path;
    this.code = code;
  }
}
