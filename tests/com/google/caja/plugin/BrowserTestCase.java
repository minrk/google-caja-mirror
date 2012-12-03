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

package com.google.caja.plugin;

import com.google.caja.lexer.escaping.Escaping;
import com.google.caja.reporting.BuildInfo;
import com.google.caja.reporting.MessageQueue;
import com.google.caja.util.CajaTestCase;
import com.google.caja.util.LocalServer;
import com.google.caja.util.RewritingResourceHandler;

import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.net.MalformedURLException;
import java.net.URL;
import java.util.List;

import com.google.common.base.Joiner;
import org.mortbay.jetty.servlet.Context;
import org.openqa.selenium.By;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.remote.DesiredCapabilities;
import org.openqa.selenium.remote.RemoteWebDriver;

/**
 * Test case class with tools for controlling a web browser running pages from
 * a local web server.
 * <p>
 * Useful system properties:
 * <dl>
 *   <dt>caja.test.browser</dt>
 *   <dd>Which browser driver to use. Default is "firefox".</dd>
 *
 *   <dt>caja.test.browserPath</dt>
 *   <dd>Override location of browser executable.  Currently only
 *   for Chrome (sets chrome.binary for webdriver).</dd>
 *
 *   <dt>caja.test.headless</dt>
 *   <dd>When true, skip browser tests</dd>
 *
 *   <dt>caja.test.remote</dt>
 *   <dd>URL of a remote webdriver, which should usually be something like
 *   "http://hostname:4444/wd/hub".  If unset, use a local webdriver.</dd>
 *
 *   <dt>caja.test.serverOnly</dt>
 *   <dd>When true, start server and wait</dd>
 *
 *   <dt>caja.test.startAndWait</dt>
 *   <dd>When true, start server and browser and wait</dd>
 *
 *   <dt>caja.test.thishostname</dt>
 *   <dd>Hostname that a remote browser should use to contact the
 *   localhost server. If unset, guesses a non-loopback hostname.</dd>
 * </dl>
 *
 * @author maoziqing@gmail.com (Ziqing Mao)
 * @author kpreid@switchb.org (Kevin Reid)
 */
public abstract class BrowserTestCase extends CajaTestCase {
  private static final String BROWSER = "caja.test.browser";
  private static final String BROWSER_PATH = "caja.test.browserPath";
  private static final String HEADLESS = "caja.test.headless";
  private static final String REMOTE = "caja.test.remote";
  private static final String SERVER_ONLY = "caja.test.serverOnly";
  private static final String START_AND_WAIT = "caja.test.startAndWait";

  // This being static is a horrible kludge to be able to reuse the WebDriver
  // instance between individual tests. There is no narrower scope we can use,
  // unless we were to move to JUnit 4 style tests, which have per-class setup.
  static WebDriver driver = null;
  static {
    Runtime.getRuntime().addShutdownHook(new Thread(new Runnable() {
      public void run() {
        if (driver != null) {
          // Close current window, which will quit if it's the only window.
          driver.close();
          driver = null;
        }
      }
    }));
  }

  protected String testBuildVersion = null;

  protected final BuildInfo buildInfo = new BuildInfo() {
    @Override public void addBuildInfo(MessageQueue mq) {
      BuildInfo.getInstance().addBuildInfo(mq);
    }
    @Override public String getBuildInfo() {
      return BuildInfo.getInstance().getBuildInfo();
    }
    @Override public String getBuildVersion() {
      return (testBuildVersion != null)
          ? testBuildVersion
          : BuildInfo.getInstance().getBuildVersion();
    }
    @Override public String getBuildTimestamp() {
      return BuildInfo.getInstance().getBuildTimestamp();
    }
    @Override public long getCurrentTime() {
      return BuildInfo.getInstance().getCurrentTime();
    }
  };

  private final int portNumber = 8000;

  private final LocalServer localServer = new LocalServer(
      portNumber,
      new LocalServer.ConfigureContextCallback() {
        @Override public void configureContext(Context ctx) {
          addServlets(ctx);
        }
      });

  @Override
  public void setUp() throws Exception {
    super.setUp();
  }

  @Override
  public void tearDown() throws Exception {
    localServer.getCajaStatic().clear();
    setTestBuildVersion(null);
    super.tearDown();
  }

  protected RewritingResourceHandler getCajaStatic() {
    return localServer.getCajaStatic();
  }

  /**
   * Set a custom build version for testing. This will be used by the cajoling
   * service to stamp outgoing cajoled modules. Set this to <code>null</code>
   * to disable custom test build version and revert to default behavior.
   *
   * @param version the desired test build version.
   */
  protected void setTestBuildVersion(String version) {
    testBuildVersion = version;
  }

  /**
   * Start the web server and browser, go to pageName, call driveBrowser(driver,
   * pageName), and then clean up.
   */
  protected String runBrowserTest(String pageName, String... params)
      throws Exception {
    return runBrowserTest(pageName, 0, params);
  }

  protected String runBrowserTest(String pageName, Object data, String... params)
      throws Exception {
    if (flag(SERVER_ONLY) || flag(START_AND_WAIT)) {
      pageName = "test-index.html";
      params = null;
    }
    String localhost = "localhost";
    if (System.getProperty(REMOTE) != null) {
      localhost = localServer.hostname();
    }
    String page = "http://" + localhost + ":" + portNumber
        + "/ant-testlib/com/google/caja/plugin/" + pageName;
    if (params != null && params.length > 0) {
      page += "?" + Joiner.on("&").join(params);
    }
    // The test runner may catch output so go directly to file descriptor 2.
    @SuppressWarnings("resource")
    PrintStream err = new PrintStream(
        new FileOutputStream(FileDescriptor.err), false, "UTF-8");
    err.println("- Try " + page);
    String result = "";
    boolean passed = false;
    try {
      try {
        localServer.start();
      } catch (Exception e) {
        err.println(e);
        throw e;
      }

      if (flag(SERVER_ONLY)) {
        Thread.currentThread().join();
      }

      if (driver == null) {
        driver = makeDriver();
      }
      driver.get(page);
      if (flag(START_AND_WAIT)) {
        Thread.currentThread().join();
      }

      result = driveBrowser(driver, data, pageName);
      passed = true;
    } finally {
      if (!passed && driver != null) {
        // It's helpful for debugging to keep failed windows open.
        switchToNewWindow(driver);
      }
      localServer.stop();
    }
    return result;
  }

  static int windowSeq = 1;

  protected void switchToNewWindow(WebDriver driver) {
    JavascriptExecutor jsexec = (JavascriptExecutor) driver;
    String name = "btcwin" + (windowSeq++);
    jsexec.executeScript("window.open('', '" + name + "')");
    driver.switchTo().window(name);
  }

  static protected boolean flag(String name) {
    String value = System.getProperty(name);
    return value != null && !"".equals(value) && !"0".equals(value)
        && !"false".equalsIgnoreCase(value);
  }

  protected String runTestDriver(
      String testDriver, boolean es5, String... params)
      throws Exception {
    return runBrowserTest("browser-test-case.html",
        add(params,
            "es5=" + es5,
            "test-driver=" + escapeUri(testDriver)));
  }

  protected String runTestCase(
      String testCase, boolean es5, String... params)
      throws Exception {
    return runBrowserTest("browser-test-case.html",
        add(params,
            "es5=" + es5,
            "test-case=" + escapeUri(testCase)));
  }

  protected static String escapeUri(String s) {
    StringBuilder sb = new StringBuilder();
    Escaping.escapeUri(s, sb);
    return sb.toString();
  }

  protected static String[] add(String[] arr, String... rest) {
    String[] result = new String[arr.length + rest.length];
    System.arraycopy(arr, 0, result, 0, arr.length);
    System.arraycopy(rest, 0, result, arr.length, rest.length);
    return result;
  }

  /**
   * Do what should be done with the browser.
   * @param pageName The tail of a URL.  Unused in this implementation
   */
  protected String driveBrowser(
      final WebDriver driver, Object data, final String pageName) {
    poll(20000, 200, new Check() {
      @Override public String toString() { return "startup"; }
      public boolean run() {
        List<WebElement> readyElements = driver.findElements(
            By.xpath("//*[@class='readytotest']"));
        return readyElements.size() != 0;
      }
    });

    poll(20000, 1000, new Check() {
      private List<WebElement> clickingList = null;
      @Override public String toString() {
        return "clicking done (Remaining elements = " +
            renderElements(clickingList) + ")";
      }
      public boolean run() {
        clickingList = driver.findElements(By.xpath(
            "//*[contains(@class,'clickme')]/*"));
        for (WebElement e : clickingList) {
          e.click();
        }
        return clickingList.isEmpty();
      }
    });

    poll(80000, 1000, new Check() {
      private List<WebElement> waitingList = null;
      @Override public String toString() {
        return "completion (Remaining elements = " +
            renderElements(waitingList) + ")";
      }
      public boolean run() {
        waitingList =
            driver.findElements(By.xpath("//*[contains(@class,'waiting')]"));
        return waitingList.isEmpty();
      }
    });

    // check the title of the document
    String title = driver.getTitle();
    assertTrue("The title shows " + title, title.contains("all tests passed"));
    return title;
  }

  /**
   * Run 'c' every 'intervalMillis' milliseconds until it returns true or
   * 'timeoutSecs' seconds have passed (in which case, fail).
   */
  protected static void poll(
      int timeoutMillis, int intervalMillis, Check c) {
    int rounds = 0;
    int limit = timeoutMillis / intervalMillis;
    for (; rounds < limit; rounds++) {
      if (c.run()) {
        break;
      }
      try {
        Thread.sleep(intervalMillis);
      } catch (InterruptedException e) {
        // keep going
      }
    }
    assertTrue(
        timeoutMillis + " ms passed while waiting for: " + c + ".",
        rounds < limit);
  }

  protected static String renderElements(List<WebElement> elements) {
    StringBuilder sb = new StringBuilder();
    sb.append('[');
    for (int i = 0, n = elements.size(); i < n; i++) {
      if (i != 0) { sb.append(", "); }
      WebElement el = elements.get(i);
      sb.append('<').append(el.getTagName());
      String id = el.getAttribute("id");
      if (id != null) {
        sb.append(" id=\"");
        Escaping.escapeXml(id, false, sb);
        sb.append('"');
      }
      String className = el.getAttribute("class");
      if (className != null) {
        sb.append(" class=\"");
        Escaping.escapeXml(className, false, sb);
        sb.append('"');
      }
      sb.append('>');
    }
    sb.append(']');
    return sb.toString();
  }

  /**
   * Add servlets as desired specific to a given test case.
   *
   * @param servlets a Jetty Context to which servlets can be added.
   */
  protected void addServlets(Context servlets) {
    // Adds none but may be overridden.
  }

  public interface Check {
    boolean run();
  }

  private WebDriver makeDriver() throws MalformedURLException {
    if (flag(HEADLESS)) {
      return null;
    }
    String browser = System.getProperty(BROWSER, "firefox");
    String browserPath = System.getProperty(BROWSER_PATH);
    String remote = System.getProperty(REMOTE, "");
    DesiredCapabilities dc = new DesiredCapabilities();
    if (!"".equals(remote)) {
      dc.setBrowserName(browser);
      dc.setJavascriptEnabled(true);
      return new RemoteWebDriver(new URL(remote), dc);
    }
    if ("chrome".equals(browser)) {
      if (browserPath != null) {
        dc.setCapability("chrome.binary", browserPath);
      }
      return new ChromeDriver(dc);
    } else if ("firefox".equals(browser)) {
      return new FirefoxDriver();
    } else {
      throw new RuntimeException("Unsupported local browser '" + browser + "'");
    }
  }
}
