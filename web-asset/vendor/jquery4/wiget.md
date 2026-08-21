# Cambridge dbclick widget

Did you know that you can get an instant definition of any word on this page, just by double-clicking on it?

Try it now! Double-click on any of the following words to see the definition: a, opt, psychology, stop, walk.

You can also look up phrases, such as a bite to eat. Just use your mouse to highlight the phrase and click on the word Definition when it appears.

You can add this functionality to your site as well — follow the instructions:

Make sure your site uses the latest version of jQuery. If you are not using jQuery, you can download it from jquery.com. You will then need to call the jQuery javascript file from the head of your HTML pages.

```html
<script language="JavaScript" type="text/javascript" src="./web-asset/vendor/jquery4/jquery.js"></script>
```

Download the dblclick.js file, and add it to your site. Again, you will need to call the javascript file from the head
of your HTML pages.

```html
<script language="JavaScript" type="text/javascript" src="./web-asset/vendor/jquery4/dblclick.js"></script>
```

Finally, call the setupDoubleClick function by adding an onload attribute to your HTML body element.

```html
<body onload=" setupDoubleClick( 'https://dictionary.cambridge.org/', 'american', false, null, 5, 'popup' ) ">
```

Get our free Widgets
It's easy to add the power of Cambridge Dictionary to your website using our free search box widgets.

## HTML Search Box Widget for your website

Don't use gadgets or javascript on your website? Add our Free Search Box to your own website by copying the code below into your website code wherever you want the search box to appear.

```js
<form action='https://dictionary.cambridge.org/search/english/direct/' method='get' target='_blank'> <input type='hidden' name='utm_source' value='widget_searchbox_source'/> <input type='hidden' name='utm_medium' value='widget_searchbox'/> <input type='hidden' name='utm_campaign' value='widget_tracking'/> <table style='font-family:Arial,Helvetica,sans-serif;font-size:10px;background:#1D2A57;border-collapse:collapse;border-spacing:0;width:150px;background-image:linear-gradient(to right,#0f193d,#2c2f62,#1a2753)'> <caption style='display:none;'>CUP free search box</caption> <tbody> <tr> <td colspan='2' style='padding:0;background:none;border:none;'> <a href='https://dictionary.cambridge.org/' style='display:block;background:transparent url(https://dictionary.cambridge.org/external/images/freesearch/sbl.png?version=6.0.80) no-repeat 5px 6px;height:32px;'></a> </td> </tr> <tr> <td style='width:130px;background:none;border:none;padding:0;font-size:10px;border-collapse:collapse;border-spacing:0;'> <input style='margin:4px;padding:0 0 0 3px;display:block;font-family:Arial,Helvetica,sans-serif;font-size:10px;border:1px solid #ddd;border-radius:20px;box-shadow:inset 1px 1px 2px 0 rgba(0,0,0,0.1);color:#444;' name='q' placeholder='Search English' type='search' title='search' dir='auto' role='textbox' autocomplete='off' aria-controls='search' aria-multiline='false' aria-expanded='false' aria-label='Search' aria-required='true' aria-invalid='false' /> </td> <td style='width:20px;background:none;border:none;padding:0 4px 0 0;font-size:10px;border-collapse:collapse;border-spacing:0;'> <button style='width:15px;height:15px;vertical-align:top;display:inline-block;border:none;border-radius:50%;text-align:center;text-transform:none;padding:0;background:#FEC400;cursor:pointer;overflow:hidden;' title='Search' type='submit'> <img src='https://dictionary.cambridge.org/external/images/freesearch/search.png?version=6.0.80' style='vertical-align:-1px;border:none;height:auto;margin:0;padding:0;text-align:center;'/> </button> </td> </tr> </tbody> </table> </form>
```
