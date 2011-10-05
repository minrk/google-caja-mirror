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

package com.google.caja.gwtbeans.shared;

import java.util.Map;

import com.google.gwt.core.client.JavaScriptObject;
import com.google.gwt.user.client.rpc.AsyncCallback;

public interface Frame {
  
  Frame cajoled(String uri, String js, String html);

  Frame code(String uri, String mimeType, String content);
    
  Frame api(Map<String, JavaScriptObject> api);
  
  Frame api(JavaScriptObject api);  
    
  void run(AsyncCallback<JavaScriptObject> callback);

  JavaScriptObject getNative();
}
