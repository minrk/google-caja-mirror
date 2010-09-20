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

package com.google.caja.tools;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.PrintStream;
import java.io.Writer;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

import com.google.caja.lexer.escaping.Escaping;
import com.google.caja.util.Charsets;
import com.google.caja.util.Lists;
import com.google.caja.util.Strings;

/**
 * Outputs JavaScript that defines symbols for each value in a java enum so that
 * Java and JavaScript code can interoperate.
 *
 * @author Mike Samuel <mikesamuel@gmail.com>
 */
public final class EnumsToJs implements BuildCommand {

  public boolean build(
      List<File> inputs, List<File> dependencies, File output) {
    List<Class<? extends Enum<?>>> enumClasses = loadEnumClasses(
        inputs, System.err);
    if (enumClasses == null) { return false; }

    try {
      Writer out = new OutputStreamWriter(
          new FileOutputStream(output), Charsets.UTF_8);
      try {
        generateJavaScriptForEnums(enumClasses, out);
      } finally {
        out.close();
      }
    } catch (IOException ex) {
      ex.printStackTrace();
      return false;
    }

    return true;
  }

  private List<Class<? extends Enum<?>>> loadEnumClasses(
      Iterable<? extends File> inputs, PrintStream err) {
    List<Class<? extends Enum<?>>> enumClasses = Lists.newArrayList();
    for (File input : inputs) {
      String path = input.getPath();
      int start = path.indexOf(File.separator + "com" + File.separator);
      path = path.substring(start + 1);
      String className = path.replaceFirst("\\.class$", "")
          .replace(File.separatorChar, '.');
      ClassLoader loader = getClass().getClassLoader();
      Class<? extends Enum<?>> enumClass;
      try {
        Class<?> cl = (
            loader != null
            ? loader.loadClass(className)
            : Class.forName(className));
        @SuppressWarnings("unchecked")
        Class<? extends Enum<?>> clazz = (Class<? extends Enum<?>>)
            (cl.asSubclass(Enum.class));
        enumClass = clazz;
      } catch (ClassNotFoundException ex) {
        err.println("Could not find class " + className + " for " + path);
        return null;
      } catch (ClassCastException ex) {
        err.println("Class " + className + " for " + path + " is not an enum");
        return null;
      }
      enumClasses.add(enumClass);
    }
    return enumClasses;
  }

  void generateJavaScriptForEnums(
      Iterable<Class<? extends Enum<?>>> enumClasses, Appendable out)
      throws IOException {
    out.append("// Autogenerated by ").append(getClass().getName())
        .append("\n");
    for (Class<? extends Enum<?>> enumClass : enumClasses) {
      String classNameUnderscored = Strings.toUpperCase(
          enumClass.getSimpleName().replaceAll("([a-z0-9$])([A-Z])", "$1_$2"));
      out.append("\n// From ").append(enumClass.getName()).append("\n");
      // We do a bit of type trickery here.
      // This is sound because of two facts:
      // (1) All concrete enum classes are final.  We reject the one
      //     non-concrete class above, Enum itself.
      //     Given that class instances are immutable, there is no
      //     difference between Class<? extends Enum<E>> and Class<Enum<E>>.
      // (2) All enum subclasses have themselves as their type parameter.
      //     So there is no difference between
      //     <E extends Enum<?>> and <E extends Enum<E>> once we have
      //     ruled out the base Enum class itself.
      @SuppressWarnings("rawtypes")
      Class<? extends Enum> raw = enumClass;
      @SuppressWarnings("unchecked")
      Set<?> values = EnumSet.allOf(raw);
      // Output an array of values so JavaScript can convert an index to a name.
      out.append("var ").append(classNameUnderscored).append(" = [");
      {
        boolean first = true;
        for (Object value : values) {
          Enum<?> enumValue = (Enum<?>) value;
          out.append(first ? "'" : ", '");
          Escaping.escapeJsString(enumValue.name(), false, false, out);
          out.append('\'');
          first = false;
        }
      }
      out.append("];\n");
      // Output easily inline variables, one per value, mapping symbolic names
      // to indices.
      for (Object value : values) {
        Enum<?> enumValue = (Enum<?>) value;
        String name = classNameUnderscored + "$" + enumValue.name();
        out.append("var ").append(name).append(" = ")
            .append(Integer.toString(enumValue.ordinal())).append(";\n");
      }
    }
  }
}
