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

import com.google.gwt.core.client.JavaScriptObject;
import com.google.gwt.dom.client.Element;

public class ElementTamingImpl
    extends AbstractTaming<Element>
    implements ElementTaming {
  @Override
  protected native JavaScriptObject getNative(Frame m, Element bean) /*-{
    return m.@com.google.caja.gwtbeans.shared.FrameImpl::getFrame()()
        .imports.tameNodeAsForeign___(bean);
  }-*/;
  
  @Override
  protected String getBeanClassName() {
    return "class com.google.gwt.dom.client.Element";
  }
}