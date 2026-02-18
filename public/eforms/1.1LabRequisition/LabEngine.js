/**
 *   Main data fetching function
 *   @param numberFormat Object containing the string id for each lab type. eg {Hb:"718-7", "EGFR": ["33914-3", "1234-5"]};
 *   @param onAllResultsFetched A callback function that is passed an object with a value and date for each different measure requested
 *   @param returnAll  If true, returns each lab value as an array of numbers sorted by newest to oldest. If false, returns an array with only the latest value
 *   
 *   The example above would return an object that could be accessed like so
 *      data.Hb.value, data.Hb.date, data.EGFR.value, data.EGFR.date
 */

var labReqEngine = (function() { // This is 'closure'. It returns labReqEngine at the end, and everthing else is hidden from the rest of the program

  function sortByDate(objectA, objectB) {
    return (new Date(objectB.date)).valueOf() - (new Date(objectA.date)).valueOf();
  }

  // only the first three parameters are mandatory. Returns a jquery deferred object.
  function labReqEngine(loinc, testName, onAllResultsFetched, returnAll, debugFlag, expectedValue) {
    // Assume loinc is a string or an array of strings
    if (typeof loinc === "string") {
      return $.get(getUrl(loinc, testName))
        .done(function callback(result) {
          var parsedData = parseTable(result, returnAll, debugFlag, expectedValue);
          onAllResultsFetched(parsedData, getUrl(loinc, testName));
        })
        .fail(function (error) {
          console.error(error);
        });

    } else {
      console.log("Multiple loinc codes");
      var fetchedData;
      var requests = [];  
      for (var i = 0; i < loinc.length; i++) {
        requests.push(
          $.get( getUrl(loinc[i], testName), function (result) {
            var parsedData = parseTable(result, returnAll, debugFlag, expectedValue);

            if (returnAll) {
              // Merge the data with any existing measures, and keep it sort it from newest to oldest
              var existingData = fetchedData || [];
              fetchedData = existingData.concat(parsedData).sort(sortByDate); 

            } else if (!fetchedData || !fetchedData.date || ((new Date(fetchedData.date)).valueOf() < (new Date(parsedData.date)).valueOf())) {

              fetchedData = parsedData; // Get the first (newest) item
            }
          })
        );
      }

      return $.when.apply($, requests).then(function() {
        var allUrls = _.map(loinc, function(singleLoincCode) {
          return getUrl(singleLoincCode, testName);
        });
        // After all measurement requests complete, perform a callback on the object the data was recorded on
        onAllResultsFetched(fetchedData, allUrls);
      }, function onError(error) {
        console.error(error);
      });
    }
  }

  function getUrl(loinc, testName) {
    var demographic = QueryString.demographic_no || QueryString.demographicNo || console.error("Failed to find demographic number");

    var pathArray = window.location.pathname.split('/');
    var newUrl = window.location.protocol + "//" + window.location.host + "/" + pathArray[1] + "/lab/CA/ON/labValues.jsp?testName=" + testName + "&demo="+demographic+"&labType=HL7&identifier=" + loinc;

    return newUrl;
  }

  // This will be unique to each new webpage you try and parse.
  // Doesn't carry over very well. Very susceptible to changes in page format
  function parseTable(data, returnAll, debugFlag, expectedValue) {
    // Declare all our variables
    var jData = $($.parseHTML(data)); // being finicky
    var dataIndex, dateIndex;

    var table = $(jData.find("#tblDiscs"));
    // Gets the measurement names from the first row (tr) in a table
    var headers = $(table.find("tr:first-child td")); 


    for (var i = 1; i < headers.length; i++) {
      var header = headers.get(i);
      if ($(header).text().indexOf("Result") !== -1) { // check if contains Result in name
        dataIndex = i;
      } else if ($(header).text().indexOf("Date") !== -1) { // If it doesn't, check if it contains Data
        dateIndex = i;
      }
    }

    if (!dateIndex || !dataIndex) {
      console.error("Could not find data column in list of headers", headers.contents());
      return returnObject; // returns an object with empty data
    }

    if (returnAll) {
      var returnObjectArray = [];
      var rows = table.find("tr"); // table with id="tblDiscs", get all its rows
      //Start at 1, skip the first row in table (it's only headers, no data)
      for (var i = 1; i < rows.length; i++) {
        var columns = $(rows[i]).find("td");
        returnObjectArray.push({
          value: $(columns.get(dataIndex)).text(),
          date: $(columns.get(dateIndex)).text().split(" ")[0] 
        });
      }
      return returnObjectArray.reverse();
    } else {
      // Easiest way of getting latest value. :first-child gets the top of the list
      // For greater accuracy, rewrite to compare dates (take longer to parse for large tables)
      if (table.find("tr").length > 1) {
        var lastRowColumns = table.find("tr:last-child td");

        if (debugFlag && expectedValue && $(lastRowColumns.get(dataIndex)).text() != expectedValue) debugger;
        return {
          value: $(lastRowColumns.get(dataIndex)).text(),
          date: $(lastRowColumns.get(dateIndex)).text().split(" ")[0]
        }; // object, not an array
      } else {
        return {}; // Return an empty object if no data exists in table
      }
    }
  }


  return labReqEngine;
})();