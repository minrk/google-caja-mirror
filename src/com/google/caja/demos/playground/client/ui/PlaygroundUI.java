/**
 *
 */
package com.google.caja.demos.playground.client.ui;

import com.google.gwt.core.client.GWT;
import com.google.gwt.uibinder.client.UiBinder;
import com.google.gwt.uibinder.client.UiField;
import com.google.gwt.user.client.ui.AbsolutePanel;
import com.google.gwt.user.client.ui.Button;
import com.google.gwt.user.client.ui.CheckBox;
import com.google.gwt.user.client.ui.Composite;
import com.google.gwt.user.client.ui.HTML;
import com.google.gwt.user.client.ui.HorizontalPanel;
import com.google.gwt.user.client.ui.Label;
import com.google.gwt.user.client.ui.MultiWordSuggestOracle;
import com.google.gwt.user.client.ui.SuggestBox;
import com.google.gwt.user.client.ui.TabLayoutPanel;
import com.google.gwt.user.client.ui.TextArea;
import com.google.gwt.user.client.ui.TextBox;
import com.google.gwt.user.client.ui.Tree;
import com.google.gwt.user.client.ui.VerticalPanel;
import com.google.gwt.user.client.ui.Widget;

/**
 * Playground UI binder initialization
 *
 * @author Jasvir Nagra (jasvir@gmail.com)
 */
public class PlaygroundUI extends Composite {
  @UiField protected AbsolutePanel gwtShim;
  @UiField protected TextBox renderResult;
  @UiField protected HTML renderPanel;
  @UiField protected VerticalPanel runtimeMessages;
  @UiField protected TabLayoutPanel editorPanel;
  @UiField protected PlaygroundEditor sourceText;
  @UiField protected TextArea policyText;
  @UiField protected Label version;
  @UiField protected HorizontalPanel loadingLabel;
  @UiField protected Button goButton;
  @UiField protected Button cajoleButton;
  @UiField protected Button loadButton;
  @UiField protected Button clearButton;
  @UiField protected Button defaultButton;
  @UiField protected Tree exampleTree;
  @UiField protected HorizontalPanel feedbackPanel;
  @UiField protected CheckBox unsafe;
  @UiField protected Label renderTime;

  @UiField(provided=true)
  protected SuggestBox addressField;

  @UiField(provided=true)
  protected SuggestBox policyAddressField;

  private static final PlaygroundUiBinder UI_BINDER =
    GWT.create(PlaygroundUiBinder.class);

  interface PlaygroundUiBinder extends UiBinder<Widget, PlaygroundUI> {
    // No new methods.  Just a parameterized UiBinder.
  }

  public PlaygroundUI(MultiWordSuggestOracle sourceSuggestions,
      MultiWordSuggestOracle policySuggestions) {
    addressField = new SuggestBox(sourceSuggestions);
    policyAddressField = new SuggestBox(policySuggestions);

    initWidget(UI_BINDER.createAndBindUi(this));
  }
}
