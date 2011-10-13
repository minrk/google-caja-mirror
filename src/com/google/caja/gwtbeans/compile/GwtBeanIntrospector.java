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

package com.google.caja.gwtbeans.compile;

import java.util.HashMap;
import java.util.Map;

import com.google.gwt.core.ext.GeneratorContext;
import com.google.gwt.core.ext.TreeLogger;
import com.google.gwt.core.ext.TreeLogger.Type;
import com.google.gwt.core.ext.UnableToCompleteException;
import com.google.gwt.core.ext.typeinfo.JClassType;
import com.google.gwt.core.ext.typeinfo.JMethod;
import com.google.gwt.core.ext.typeinfo.JType;
import com.google.gwt.core.ext.typeinfo.TypeOracle;
import com.google.gwt.core.ext.typeinfo.JPrimitiveType;

public final class GwtBeanIntrospector {
  private final Map<JType, GwtBeanInfo> byBeanType =
      new HashMap<JType, GwtBeanInfo>();
  private final Map<JClassType, GwtBeanInfo> byTamingInterface =
      new HashMap<JClassType, GwtBeanInfo>();
  private final TamingConfiguration configuration;
  private final TreeLogger logger;
  private final GeneratorContext context;

  public GwtBeanIntrospector(
      TreeLogger logger,
      GeneratorContext context)
      throws UnableToCompleteException {
    this.logger = logger;
    this.context = context;
    this.configuration = new TamingConfiguration(logger, context);
  }

  public GwtBeanInfo getBeanInfoByBeanType(JType beanType)
      throws UnableToCompleteException {
    if (!byBeanType.containsKey(beanType)) {
      GwtBeanInfo bi = newByBeanType(logger, context, beanType);
      byBeanType.put(beanType, bi);
      byTamingInterface.put(bi.getTamingInterface(), bi);
    }
    return byBeanType.get(beanType);
  }

  public GwtBeanInfo getBeanInfoByTamingInterface(JClassType tamingInterface)
      throws UnableToCompleteException {
    if (!byTamingInterface.containsKey(tamingInterface)) {
      GwtBeanInfo bi = newByTamingInterface(logger, context, tamingInterface);
      byBeanType.put(bi.getType(), bi);
      byTamingInterface.put(tamingInterface, bi);
    }
    return byTamingInterface.get(tamingInterface);
  }

  private GwtBeanInfo newByBeanType(
      TreeLogger logger,
      GeneratorContext context,
      JType type)
      throws UnableToCompleteException {
    if (isAllowablePrimitiveType(context.getTypeOracle(), type)) {
      return makePrimitiveGwtBeanInfo(type);
    } else if (type instanceof JClassType) {
      JClassType tamingInterface =
          configuration.getTamingInterfaceByBeanClass((JClassType) type);
      if (tamingInterface == null) {
        logger.log(Type.ERROR,
            "Bean type " + type.getQualifiedSourceName()
            + " has no known taming");
        throw new UnableToCompleteException();
      }
      JClassType tamingImplementation = configuration
          .getTamingImplementationByTamingInterface(tamingInterface);
      return tamingImplementation == null
          ? new DefaultGwtBeanInfo(
              logger, context, (JClassType) type, tamingInterface)
          : makeSimpleGwtBeanInfo(
              type, false, tamingInterface, tamingImplementation);
    } else {
      logger.log(Type.ERROR,
          "Cannot create taming for non-class type "
          + type.getQualifiedSourceName());
      throw new UnableToCompleteException();
    }
  }

  private GwtBeanInfo newByTamingInterface(
      TreeLogger logger,
      GeneratorContext context,
      JClassType tamingInterface)
      throws UnableToCompleteException {
    JClassType beanClass =
        configuration.getBeanClassByTamingInterface(tamingInterface);
    if (beanClass == null) {
      logger.log(Type.ERROR,
          "Taming interface " + tamingInterface.getQualifiedSourceName()
          + " is not a known taming");
      throw new UnableToCompleteException();
    }
    JClassType tamingImplementation = configuration
        .getTamingImplementationByTamingInterface(tamingInterface);
    return tamingImplementation == null
        ? new DefaultGwtBeanInfo(
            logger, context, beanClass, tamingInterface)
        : makeSimpleGwtBeanInfo(
            beanClass, false, tamingInterface, tamingImplementation);
  }

  private GwtBeanInfo makePrimitiveGwtBeanInfo(final JType type) {
    return makeSimpleGwtBeanInfo(type, true, null, null);
  }

  private GwtBeanInfo makeSimpleGwtBeanInfo(
      final JType type,
      final boolean tamingPrimitiveType,
      final JClassType tamingInterface,
      final JClassType tamingImplementation) {
    return new GwtBeanInfo() {
      @Override public JType getType() {
        return type;
      }
      @Override public boolean isTamingPrimitiveType() {
        return tamingPrimitiveType;
      }
      @Override public JClassType getTamingInterface() {
        return tamingInterface;
      }
      @Override public JClassType getTamingImplementation() {
        return tamingImplementation;
      }
      @Override public GwtBeanPropertyDescriptor[] getProperties() {
        return null;
      }
      @Override public JMethod[] getMethods() {
        return null;
      }
    };
  }
  
  /**
   * Whether the supplied type is a valid GWT primitive type.
   */
  private boolean isAllowablePrimitiveType(TypeOracle to, JType type) {
    // Note that we do not include GWT class Element in this list, though it is
    // treated by GWT JSNI as a primitive. Instead, we hard-code an actual
    // Taming class for class Element that does the necessary DOM taming.
    return
        (type instanceof JPrimitiveType && type != JPrimitiveType.LONG)
        || type == to.findType("java.lang.String");
  }
}
