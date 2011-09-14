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

package com.google.caja.demos.gwtbeans.compile;

import com.google.gwt.core.ext.typeinfo.JMethod;
import com.google.gwt.core.ext.typeinfo.JType;

/**
 * The description of a Bean property, in terms of its component methods. 
 */
public final class GwtBeanPropertyDescriptor {
  public final String name;
  public final JType type;
  public final JMethod readMethod;
  public final JMethod writeMethod;
  
  public GwtBeanPropertyDescriptor(
      String name, 
      JType type, 
      JMethod readMethod, 
      JMethod writeMethod) {
    this.name = name;
    this.type = type;
    this.readMethod = readMethod;
    this.writeMethod = writeMethod;
  }
}