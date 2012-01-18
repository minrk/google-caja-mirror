// Copyright (C) 2012 Google Inc.
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

package com.google.caja.util;

import org.mortbay.jetty.Server;
import org.mortbay.jetty.handler.ContextHandler;
import org.mortbay.jetty.handler.ResourceHandler;
import org.mortbay.jetty.Handler;
import org.mortbay.jetty.handler.DefaultHandler;
import org.mortbay.jetty.handler.HandlerList;
import org.mortbay.jetty.servlet.Context;
import org.mortbay.jetty.servlet.ServletHolder;

import com.google.caja.service.CajolingService;
import com.google.caja.service.CajolingServlet;

import com.google.caja.reporting.BuildInfo;

/**
 * Encapsulates the management of a localhost Web server running on a specified
 * port, serving up the Caja resources and servlets, to be used for testing.
 */
public class LocalServer {
  private final int portNumber;
  private final ConfigureContextCallback contextCallback;
  private Server server;

  public interface ConfigureContextCallback {
    void configureContext(Context ctx);
  }
  
  protected final RewritingResourceHandler cajaStatic =
      new RewritingResourceHandler();
  { cajaStatic.setResourceBase("./ant-war/"); }

  public LocalServer(int portNumber, ConfigureContextCallback contextCallback) {
    this.portNumber = portNumber;
    this.contextCallback = contextCallback;
  }

  /**
   * Start a local web server on the port specified by portNumber().
   */
  public void start() throws Exception {
    server = new Server(portNumber);

    // static file serving for tests
    final ResourceHandler resource_handler = new ResourceHandler();
    resource_handler.setResourceBase(".");

    // caja (=playground for now) server under /caja directory
    final String subdir = "/caja";
    final ContextHandler caja = new ContextHandler(subdir);
    {
      // TODO(kpreid): deploy the already-configured war instead of manually
      // plumbing
      final String service = "/cajole";

      // cajoling service -- Servlet setup code gotten from
      // <http://docs.codehaus.org/display/JETTY/Embedding+Jetty> @ 2010-06-30
      Context servlets = new Context(server, "/", Context.NO_SESSIONS);
      servlets.addServlet(
          new ServletHolder(
              new CajolingServlet(
                  new CajolingService(BuildInfo.getInstance(),
                      "http://localhost:" + portNumber +
                          subdir + service))),
          service);

      // Hook for subclass to add more servlets
      if (contextCallback != null) {
        contextCallback.configureContext(servlets);
      }

      final HandlerList handlers = new HandlerList();
      handlers.setHandlers(new Handler[]{
          cajaStatic,
          servlets,
          new DefaultHandler()});
      caja.setHandler(handlers);
    }

    final HandlerList handlers = new HandlerList();
    handlers.setHandlers(new Handler[] {
        resource_handler,
        caja,
        new DefaultHandler()});
    server.setHandler(handlers);

    server.start();
  }

  public com.google.caja.util.RewritingResourceHandler getCajaStatic() {
    return cajaStatic;
  }

  /**
   * Stop the local web server
   */
  public void stop() throws Exception {
    // In case of exceptions, the server will be turned down when the test exits
    server.stop();
  }
}
