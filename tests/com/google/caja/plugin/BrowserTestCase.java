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

import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.net.MalformedURLException;
import java.net.URL;
import java.util.List;
import java.util.concurrent.TimeUnit;

import com.google.common.base.Joiner;
import org.mortbay.jetty.servlet.Context;
import org.openqa.selenium.By;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.UnsupportedCommandException;
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
 * Browser testing is described in more detail at the
 * <a href="http://code.google.com/p/google-caja/wiki/CajaTesting"
 *   >CajaTesting wiki page</a>
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
 * <p>
 * Type parameter D is for data passed in to subclass overrides of driveBrowser.
 *
 * @author maoziqing@gmail.com (Ziqing Mao)
 * @author kpreid@switchb.org (Kevin Reid)
 */
public abstract class BrowserTestCase<D> extends CajaTestCase {
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

  // We keep a blank window open so the browser stays running when we close
  // a test window.
  static String firstWindow = null;

  private final static String browserType = System.getProperty(BROWSER,
      "firefox");

  static {
    Runtime.getRuntime().addShutdownHook(new Thread(new Runnable() {
      public void run() {
        if (driver != null) {
          // Close first window, which quits the browser if it's the only one.
          if (firstWindow != null) {
            driver.switchTo().window(firstWindow);
          }
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
    setTestBuildVersion(null);
    super.tearDown();
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

  static protected PrintStream errStream = null;

  // The ant junit runner captures System.err.  This returns a handle
  // to fd 2 for messages we want to go to the real stderr.
  static protected PrintStream getErr() {
    if (errStream == null) {
      errStream = new PrintStream(
          new FileOutputStream(FileDescriptor.err), true);
    }
    return errStream;
  }

  /**
   * Start the web server and browser, go to pageName, call driveBrowser(driver,
   * pageName), and then clean up.
   */
  protected String runBrowserTest(String pageName, String... params)
      throws Exception {
    return runBrowserTest(pageName, null, params);
  }

  protected String runBrowserTest(String pageName, D data,
      String... params) throws Exception {
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
    getErr().println("- Try " + page);
    String result = "";
    boolean passed = false;
    try {
      try {
        localServer.start();
      } catch (Exception e) {
        getErr().println(e);
        throw e;
      }

      if (flag(SERVER_ONLY)) {
        Thread.currentThread().join();
      }

      if (driver == null) {
        driver = makeDriver();
        firstWindow = driver.getWindowHandle();
        try {
          driver.manage().timeouts().pageLoadTimeout(15, TimeUnit.SECONDS);
          driver.manage().timeouts().setScriptTimeout(5, TimeUnit.SECONDS);
        } catch (UnsupportedCommandException e) {
          // ignore
        }
      }
      switchToNewWindow(driver);
      driver.get(page);
      if (flag(START_AND_WAIT)) {
        Thread.currentThread().join();
      }

      result = driveBrowser(driver, data, pageName);
      passed = true;
    } finally {
      localServer.stop();
      if (driver != null) {
        // It's helpful for debugging to keep failed windows open.
        if (passed || isKnownFailure()) {
          driver.close();
          driver.switchTo().window(firstWindow);
        }
      }
    }
    return result;
  }

  static int windowSeq = 1;

  protected void switchToNewWindow(WebDriver driver) {
    JavascriptExecutor jsexec = (JavascriptExecutor) driver;
    String name = "btcwin" + (windowSeq++);
    Boolean result = (Boolean) jsexec.executeScript(
        "return !!window.open('', '" + name + "')");
    if (result) {
      driver.switchTo().window(name);
    }
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
   *
   * @param data
   *          Parameter from runBrowserTest, for use by subclasses; must be null
   *          but subclasses overriding this method may make use of it.
   * @param pageName
   *          The tail of a URL. Unused in this implementation.
   */
  protected String driveBrowser(
      final WebDriver driver, final D data, final String pageName) {
    if (data != null) {
      throw new IllegalArgumentException(
          "data parameter is not used and should be null");
    }

    // 40s because test-domado-dom startup is very very very slow in es53 mode,
    // and something we're doing is leading to huge unpredictable slowdowns
    // in random test startup; perhaps we're holding onto a lot of ram and
    // we're losing on swapping/gc time.  unclear.
    countdown(40000, 200, new Countdown() {
      @Override public String toString() { return "startup"; }
      public int run() {
        List<WebElement> readyElements = driver.findElements(
            By.className("readytotest"));
        return readyElements.size() == 0 ? 1 : 0;
      }
    });

    countdown(2000, 500, new Countdown() {
      private List<WebElement> clickingList = null;
      @Override public String toString() {
        return "clicking done (Remaining elements = " +
            renderElements(clickingList) + ")";
      }
      public int run() {
        clickingList = driver.findElements(By.xpath(
            "//*[contains(@class,'clickme')]/*"));
        for (WebElement e : clickingList) {
          e.click();
        }
        return clickingList.size();
      }
    });

    // TODO(felix8a): reduce this timeout.  the problem is that progress
    // is very slow on test pages that do a lot of caja.load() calls.
    countdown(40000, 200, new Countdown() {
      private List<WebElement> waitingList = null;
      @Override public String toString() {
        return "completion (Remaining elements = " +
            renderElements(waitingList) + ")";
      }
      public int run() {
        waitingList =
            driver.findElements(By.xpath("//*[contains(@class,'waiting')]"));
        return waitingList.size();
      }
    });

    // check the title of the document
    String title = driver.getTitle();
    assertTrue("The title shows " + title, title.contains("all tests passed"));
    return title;
  }

  /**
   * Run 'c' every 'intervalMillis' until it returns 0,
   * or 'timeoutMillis' have passed since the value has changed.
   */
  protected static void countdown(
      int timeoutMillis, int intervalMillis, Countdown c) {
    int lastValue = -1;
    long endTime = System.currentTimeMillis() + timeoutMillis;
    int value;
    while ((value = c.run()) != 0) {
      long now = System.currentTimeMillis();
      if (value != lastValue) {
        endTime = now + timeoutMillis;
        lastValue = value;
      }
      if (endTime < now) {
        fail(timeoutMillis + " ms passed while waiting for: " + c);
      }
      try {
        Thread.sleep(intervalMillis);
      } catch (InterruptedException e) {
        // keep going
      }
    }
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

  public interface Countdown {
    int run();
  }

  private WebDriver makeDriver() throws MalformedURLException {
    if (flag(HEADLESS)) {
      return null;
    }
    String browserPath = System.getProperty(BROWSER_PATH);
    String remote = System.getProperty(REMOTE, "");
    DesiredCapabilities dc = new DesiredCapabilities();
    if (!"".equals(remote)) {
      dc.setBrowserName(browserType);
      dc.setJavascriptEnabled(true);
      return new RemoteWebDriver(new URL(remote), dc);
    }
    if ("chrome".equals(browserType)) {
      if (browserPath != null) {
        dc.setCapability("chrome.binary", browserPath);
      }
      return new ChromeDriver(dc);
    } else if ("firefox".equals(browserType)) {
      return new FirefoxDriver();
    } else {
      throw new RuntimeException("No local driver for browser type '"
          + browserType + "'");
    }
  }

  /**
   * Helper to respond to browser differences.
   */
  D firefoxVsChrome(D firefox, D chrome) {
    // In the event that we support testing on more browsers, this should be
    // redesigned appropriately, rather than being a long if-else.
    if ("firefox".equals(browserType)) {
      return firefox;
    } else if ("chrome".equals(browserType)) {
      return chrome;
    } else {
      return firefox;
    }
  }
}
