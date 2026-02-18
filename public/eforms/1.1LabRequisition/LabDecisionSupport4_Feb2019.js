        function autoLabReqPop() {
          scrollPage();
          insertData();
        }
        //Date Picker Code (BROKEN) - why not use conventional calendar? Fixed by Kevin Yap
       $(function() {
            var datePickerYear = $('.date-picker-year')
            if (datePickerYear.datepicker != null) {
                datePickerYear.datepicker({
                    changeYear: true,
                    showButtonPanel: true,
                    dateFormat: 'yy',
                    yearRange: "-0:+10",
                    onClose: function(dateText, inst) { 
                        var year = $("#ui-datepicker-div .ui-datepicker-year :selected").val();
                        $(this).datepicker('setDate', new Date(year, 1));
                    }
                });
            }
        $(".date-picker-year").focus(function () {
                $(".ui-datepicker-month").hide();
            });
        });

    //    function clearFit() {
    //    ($('#FUFITCB').val(''));
    //    }

    //    function clearColo() {
    //    ($('#FUColonoscopyCB').val(''));
    //    }

    //    function clearDate() {
    //    ($('#FUYear').val(''));
    //    }
        
        //special for Quentin
        function decreasefont(){
        if ($('#MSPNo').val()=='24997'){
        $("[name=AdditionalTestInstructions]").css({'font-size':'10'});
        }
        }
function insertData(){
    // check smoking box and Family History on startup and check box. Need to do this before the rest
    // removed to stop push and pull to/from SKST measurement - inactivates Framingham calculator

    if ((document.getElementById('smoker').value == 'yes')||(document.getElementById('smoker').value == 'Yes')) {
      $("#SmokingStatus").attr('checked', true);
      }

//    if ((document.getElementById('FHCVD').value == 'yes')||(document.getElementById('FHCVD').value == 'Yes')) {
//             $("#FamilyHistory").attr('checked', true);
//    }

        medicalConditions();
        medicalIssues();
        decisionSupport();
        PopValues();    
}

function popValue(config) {
    return labReqEngine(config.loinc, config.name, config.callback);
}
    
function PopValues(){
    var numberFormat = [
        {name: "Napl", loinc: "2951-2", callback: PopNapl},
        {name: "EGFR", loinc: ["33914-3","62238-1"], callback: PopEGFR},
        {name: "Kpl", loinc: "2823-3", callback: PopKpl},
        {name: "TSH", loinc: "3016-3", callback: PopTSH},
        {name: "APOB", loinc: "1884-6", callback: PopAPOB},
        {name: "TCHL", loinc: "14647-2", callback: PopTCHL},
        {name: "LDL", loinc: "39469-2", callback: PopLDL},
        {name: "HDL", loinc: "14646-4", callback: PopHDL},
        {name: "TCHD", loinc: "32309-7", callback: PopTCHD},
        {name: "TG", loinc: "14927-8", callback: PopTG},
        {name: "ACR", loinc: ["9318-7","32294-1"], callback: PopACR},
        {name: "A1C", loinc: "4548-4", callback: PopA1C},
        {name: "FBS", loinc: "14771-0", callback: PopFBS},
        {name: "RBS", loinc: "14749-6", callback: PopRBS},
        {name: "Hb", loinc: "718-7", callback: PopHb},
        {name: "WCC", loinc: ["12227-5","6690-2"], callback: PopWCC},
        {name: "PLT", loinc: "777-3", callback: PopPLT},
        {name: "INR", loinc: "6301-6", callback: PopINR},
        {name: "FER", loinc: "2276-4", callback: PopFER},
        {name: "CA", loinc: "2000-8", callback: PopCA},
        {name: "ALB", loinc: "1751-7", callback: PopALB},
        {name: "CK", loinc: "2157-6", callback: PopCK},
        {name: "ALP", loinc: "6768-6", callback: PopALP},
        {name: "PSA", loinc: "2857-1", callback: PopPSA},
        {name: "ALT", loinc: "1742-6", callback: PopALT},
        {name: "BILI", loinc: "14631-6", callback: PopBILI},
        {name: "GGT", loinc: "2324-2", callback: PopGGT},
        {name: "PROT", loinc: "2885-2", callback: PopPROT},
        {name: "FIT", loinc: "58453-2", callback: PopFIT},
        {name: "HIV", loinc: ["48345-3","XXX-2887", "20447-9", "25835-0"], callback: PopHIV},
        {name: "HpBS", loinc: ["5196-1","5195-3"], callback: PopHpBS},
        {name: "HAGM", loinc: "51913-2", callback: PopHAGM},
        {name: "HpCA", loinc: "13955-0", callback: PopHpCA},
        {name: "VB12", loinc: "14685-2", callback: PopVB12},
        {name: "URIC", loinc: "14933-6", callback: PopURIC},
        {name: "AST", loinc: "1920-8", callback: PopAST},
        {name: "TROP", loinc: "10839-9", callback: PopTROP},
        {name: "TTG", loinc: "31017-7", callback: PopTTG},
        {name: "BNP", loinc: ["30934-4","33762-6"], callback: PopBNP},
        {name: "DIL", loinc: "14877-5", callback: PopDIL},
        {name: "DIG", loinc: "14698-5", callback: PopDIG},
        {name: "LITH", loinc: "14334-7", callback: PopLITH},
        {name: "CRP", loinc: ["30522-7","1988-5"], callback: PopCRP},
        {name: "ESR", loinc: "4537-7", callback: PopESR},
        {name: "RF", loinc: "15205-8", callback: PopRF},
        {name: "ANA", loinc: "42254-3", callback: PopANA},
        {name: "CEA", loinc: "XXX-2279", callback: PopCEA},
        {name: "AFP", loinc: "1834-1", callback: PopAFP},  
        {name: "HPBA", loinc: ["5193-8","16935-9"], callback: PopHPBA}
 
    ];
  
    function getNext(index, array) {
        popValue(array[index]).then(function() {
            if (index < array.length - 1) {
                getNext(index + 1, array);
            }
        });
    }
    getNext(0, numberFormat);   
}

        
function RepeatPopValues(){
    $('.yellow').val('');
    $('#PatientInstructions').val('');
    $('.yellow').removeClass('yellow');
    PopEGFR2();PopFBS2();PopTSH2();PopTCHL2();PopA1C2();PopACR2();PopHb2();
    PopALB2();PopALT2();PopDIG2();PopLITH2();PopFIT2();PopKpl2();PopNapl2();
}

        //this scrolls the page on opening and also puts a temporary blank area so that the bottom buttoms can be raised
        function scrollPage() {
               $('body').scrollTo(320);
               $("#page1").after('<input id="Blank" type="textarea" class="DoNotPrint" style="position:absolute; left:4px; top:1050px; width:846px; height:55px; resize:none; border-style:hidden;" >');
        }
           

        function weeksToMilli(weeks) {
            return weeks * 7 * 24 * 60 * 60 * 1000;
        }

        function inRange(firstDate, lastDate, givenDate) {
            if (givenDate > firstDate && givenDate < lastDate) {
                return true;
            } else {
                return false;
            }
        }

        function monthDiff(givenDate) {
            var milliDiffernce = dateDifference = Date.now() - givenDate.valueOf();
            var months = Math.floor(dateDifference / 2.62974e9);
            var noOfMonths = months;
            if ($("#0months").css("background-color") == 'rgb(255, 255, 0)'){
            noOfMonths = months;
            }
            if ($("#3months").css("background-color") == 'rgb(255, 255, 0)'){
            noOfMonths = (months + 3);
            }
            if ($("#6months").css("background-color") == 'rgb(255, 255, 0)'){
            noOfMonths = (months + 6);
            }
            if ($("#12months").css("background-color") == 'rgb(255, 255, 0)'){
            noOfMonths = (months + 12);
            }
            return noOfMonths;         
        }

        function jQ_append(id_of_input, text, id_of_input2, text2) {
            ($(id_of_input).val($(id_of_input).val() + text)) + ($(id_of_input2).val($(id_of_input2).val() + text2));
        }

        function medicalIssues() {
        AddIfMissingTitle('CHF1',"CHF: eGFR/Na/K Q6M\nBaseline FBS/Lipid profile/ALT/ALB/CBC \n" );
        AddIfMissingTitle('CKD1',"CKD: eGFR/Na/K Q6M\nA1C/ACR/CBC/Na/K Q12M\n*Lipid profile Q24M\n*Not necessary if on statin\n" );
        AddIfMissingTitle('DM1',"DM: A1C Q6M\neGFR/Na/K/ACR/*Lipid profile Q12M\n*Not necessary if on statin\n" );
        AddIfMissingTitle('HBP1',"HBP: A1C/eGFR/Na/K Q12M\n*Lipid profile Q60M\n*Not necessary if on statin\n" );

            // Checks for medications
            var history3 = document.getElementById('history3').value;
            var history3Split = history3.split("]]-----");
            var History3 = history3Split.pop().toUpperCase();

            var history4 = document.getElementById('Meds').value;
            var history4Split = history4.split("]]-----");
            var History4 = history4Split.pop().toUpperCase();

            var allRx = History4 + '\n' + History3;
            document.getElementById('searchboxRx').value = allRx;

            
            var FreeText = /ATORVASTATIN|FLUVASTATIN|LOVASTATIN|PRAVASTATIN|ROSUVASTATIN|SIMVASTATIN/i;
            var string = document.getElementById("searchboxRx").value;
            var match = string.search(FreeText);
            if (match != -1) {
                $('#StatinC').css('color', 'red');
                $('#TheraDM').css('color', 'red');
                AddIfMissingTitle('Therapeutic1',"STATIN:Titrate statin dose not LDL.Baseline lipid profile, ALT, CK.\nThen ALT at 3M,12M,then PRN.\n" );
            }

            var FreeText = /AntipsychoticAtypical|risperidone|quetiapine|olanzapine|aripiprazole|clozapine/i;
            var string = document.getElementById("searchboxRx").value;
            var match = string.search(FreeText);
            if (match != -1) {
                $('#AAPsyC').css('color', 'red');
                $('#TheraDM').css('color', 'red');
                AddIfMissingTitle('Therapeutic1',"ATYPICAL ANTIPSYCHOTICS: A1C Q12M, Lipid profile Q24M\n" );
            }

            var FreeText = /Digoxin/i;
            var string = document.getElementById("searchboxRx").value;
            var match = string.search(FreeText);
            if (match != -1) {
                $('#DigC').css('color', 'red');
                $('#TheraDM').css('color', 'red');
                AddIfMissingTitle('Therapeutic1',"DIGOXIN: eGFR/Na/K/Dig level Q12M\n" );
            }

            var FreeText = /Spironolactone/i;
            var string = document.getElementById("searchboxRx").value;
            var match = string.search(FreeText);
            if (match != -1) {
                $('#SpiroC').css('color', 'red');
                $('#TheraDM').css('color', 'red');
                AddIfMissingTitle('Therapeutic1',"SPIRONOLACTONE: eGFR/Na/K Q3M \n" );
            }

            var FreeText = /Metformin/i;
            var string = document.getElementById("searchboxRx").value;
            var match = string.search(FreeText);
            if (match != -1) {
                $('#MetfC').css('color', 'red');
                $('#TheraDM').css('color', 'red');
                AddIfMissingTitle('Therapeutic1',"METFORMIN: eGFR/CBC Q12M\n" );
            }  

            var FreeText = /Methotrexate/i;
            var string = document.getElementById("searchboxRx").value;
            var match = string.search(FreeText);
            if (match != -1) {
                $('MethoC').css('color', 'red');
                $('#TheraDM').css('color', 'red');
                AddIfMissingTitle('Therapeutic1',"METHOTREXATE: eGFR/ALT/CBC Q2M\n" );
            }

            var FreeText = /LITHIUM/i;
            var string = document.getElementById("searchboxRx").value;
            var match = string.search(FreeText);
            if (match != -1) {
                $('#LithC').css('color', 'red');
                $('#TheraDM').css('color', 'red');
                AddIfMissingTitle('Therapeutic1',"LITHIUM: eGFR/Na/K/CBC/TSH/Lithium level Q6M \n" );
            }

            var FreeText = /LEVOTHYROXINE|THYROID/i;
            var string = document.getElementById("searchboxRx").value;
            var match = string.search(FreeText);
            if (match != -1) {
                $('#ThyrC').css('color', 'red');
                $('#TheraDM').css('color', 'red');
                AddIfMissingTitle('Therapeutic1',"THYROID: TSH Q12M\n" );
            }

            var FreeText = /AMIODARONE/i;
            var string = document.getElementById("searchboxRx").value;
            var match = string.search(FreeText);
            if (match != -1) {
                $('#AmioC').css('color', 'red');
                $('#TheraDM').css('color', 'red');
                AddIfMissingTitle('Therapeutic1',"AMIODARONE: ALT/TSH Q6M\n" );
            }

            var FreeText = /ISOTRETINOIN/i;
            var string = document.getElementById("searchboxRx").value;
            var match = string.search(FreeText);
            if (match != -1) {
                $('#AccutC').css('color', 'red');
                $('#TheraDM').css('color', 'red');
                AddIfMissingTitle('Therapeutic1',"ACCUTANE: Lipid profile/ALT Q1M\n" );
            }

            var FreeText = /PHENYTOIN/i;
            var string = document.getElementById("searchboxRx").value;
            var match = string.search(FreeText);
            if (match != -1) {
                $('#PhenyC').css('color', 'red');
                $('#TheraDM').css('color', 'red');
                AddIfMissingTitle('Therapeutic1',"PHENYTOIN: ALT/CBC Q12M\n" );
            }

            var FreeText = /VALPROIC/i;
            var string = document.getElementById("searchboxRx").value;
            var match = string.search(FreeText);
            if (match != -1) {
                $('#ValproC').css('color', 'red');
                $('#TheraDM').css('color', 'red');
                AddIfMissingTitle('Therapeutic1',"VALPROATE: ALT/CBC Q12M\n" );
            }
            var FreeText = /DABIGATRAN|RIVAROXABAN|APIXABAN/i;
            var string = document.getElementById("searchboxRx").value;
            var match = string.search(FreeText);
            if (match != -1) {
                $('#NOACC').css('color', 'red');
                $('#TheraDM').css('color', 'red');
                AddIfMissingTitle('Therapeutic1',"NOAC: eGFR Q6-12M\n" );
            }
        }

        function onBodyLoad() {
            var re = new RegExp("[?&]" + 'demographic_no' + "=([^&$]*)", "i");
            var offset = window.opener.location.search.search(re);
            if (offset == -1) {
                re = new RegExp("[?&]" + 'demographicNo' + "=([^&$]*)", "i");
                offset = window.opener.location.search.search(re);
            }
            var pathArray = window.opener.location.pathname.split('/');
            theIFrame = document.createElement("IFRAME");
            theIFrame.setAttribute("id", "dynamicIFrame");
            theIFrame.setAttribute("src", '/' + pathArray[1] + '/eform/efmformslistadd.jsp?demographic_no=' + RegExp.$1 + '&curProvider=&intment=&parentAjaxId=eforms');
            theIFrame.setAttribute("onload", "doIFrameOnLoad();");
            theIFrame.style.width = 0 + "px";
            theIFrame.style.height = 0 + "px";
        }

        function doIFrameOnLoad() {
            var re = new RegExp("[?&]" + 'demographic_no' + "=([^&$]*)", "i");
            var offset = window.opener.location.search.search(re);
            if (offset == -1) {
                re = new RegExp("[?&]" + 'demographicNo' + "=([^&$]*)", "i");
                offset = window.opener.location.search.search(re);
            }
            var demographic = RegExp.$1;
        }

        function ZK() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Potassium&demo=" + RegExp.$1 + "&labType=HL7&identifier=2823-3");
        }
        function ZNA() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Sodium&demo=" + RegExp.$1 + "&labType=HL7&identifier=2951-2");
        }
        function ZEGFR() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Estimated GFR&demo=" + RegExp.$1 + "&labType=HL7&identifier=33914-3");
        }
        function ZFBS() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Glucose Fasting&demo=" + RegExp.$1 + "&labType=HL7&identifier=14771-0");
        }
        function ZRBS() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Glucose Random&demo=" + RegExp.$1 + "&labType=HL7&identifier=14749-6");
        }
        function ZA1C() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Hemoglobin A1c&demo=" + RegExp.$1 + "&labType=HL7&identifier=4548-4");
        }
        function ZCREA() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Creatinine&demo=" + RegExp.$1 + "&labType=HL7&identifier=14682-9");
        }
        function ZCHOL() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Cholesterol&demo=" + RegExp.$1 + "&labType=HL7&identifier=14647-2");
        }
        function ZLDL() {
            window.open("../lab/CA/ON/labValues.jsp?testName=LDL Cholesterol&demo=" + RegExp.$1 + "&labType=HL7&identifier=39469-2");
        }
        function ZHDL() {
            window.open("../lab/CA/ON/labValues.jsp?testName=HDL Cholesterol&demo=" + RegExp.$1 + "&labType=HL7&identifier=14646-4");
        }
        function ZRATI() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Chol/HDL (Risk Ratio)&demo=" + RegExp.$1 + "&labType=HL7&identifier=32309-7");
        }
        function ZTRIG() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Triglycerides&demo=" + RegExp.$1 + "&labType=HL7&identifier=14927-8");
        }
        function ZACR() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Urine ACR (Albumin/Creatinine Ratio)&demo=" + RegExp.$1 + "&labType=HL7&identifier=32294-1");
        }
        function ZALT() {
            window.open("../lab/CA/ON/labValues.jsp?testName=ALT&demo=" + RegExp.$1 + "&labType=HL7&identifier=1742-6");
        }
        function ZCK() {
            window.open("../lab/CA/ON/labValues.jsp?testName=CK&demo=" + RegExp.$1 + "&labType=HL7&identifier=2157-6");
        }
        function ZHB() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Hemoglobin&demo=" + RegExp.$1 + "&labType=HL7&identifier=718-7");
        }
        function ZWBC() {
            window.open("../lab/CA/ON/labValues.jsp?testName=WBC&demo=" + RegExp.$1 + "&labType=HL7&identifier=12227-5");
        }
        function ZPLT() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Platelet Count&demo=" + RegExp.$1 + "&labType=HL7&identifier=777-3");
        }
        function ZMCV() {
            window.open("../lab/CA/ON/labValues.jsp?testName=MCV&demo=" + RegExp.$1 + "&labType=HL7&identifier=787-2");
        }
        function ZHCT() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Hematocrit&demo=" + RegExp.$1 + "&labType=HL7&identifier=4544-3");
        }
        function ZINR() {
            window.open("../lab/CA/ON/labValues.jsp?testName=INR&demo=" + RegExp.$1 + "&labType=HL7&identifier=6301-6");
        }
        function ZTSH() {
            window.open("../lab/CA/ON/labValues.jsp?testName=TSH&demo=" + RegExp.$1 + "&labType=HL7&identifier=3016-3");
        }
        function ZAST() {
            window.open("../lab/CA/ON/labValues.jsp?testName=AST&demo=" + RegExp.$1 + "&labType=HL7&identifier=1920-8");
        }
        function ZCRP() {
            window.open("../lab/CA/ON/labValues.jsp?testName=C Reactive Protein (High Sensitivity)&demo=" + RegExp.$1 + "&labType=HL7&identifier=30522-7");
        }
        function ZCRP2() {
            window.open("../lab/CA/ON/labValues.jsp?testName=C Reactive Protein&demo=" + RegExp.$1 + "&labType=HL7&identifier=1988-5");
        }
        function ZRF() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Rheumatoid Factor&demo=" + RegExp.$1 + "&labType=HL7&identifier=15205-8");
        }
        function ZBILI() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Total Bilirubin&demo=" + RegExp.$1 + "&labType=HL7&identifier=14631-6");
        }
        function ZALP() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Alkaline Phosphatase&demo=" + RegExp.$1 + "&labType=HL7&identifier=6768-6");
        }
        function ZALB() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Albumin&demo=" + RegExp.$1 + "&labType=HL7&identifier=1751-7");
        }
        function ZB12() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Vitamin B12&demo=" + RegExp.$1 + "&labType=HL7&identifier=14685-2");
        }
        function ZUREA() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Urea&demo=" + RegExp.$1 + "&labType=HL7&identifier=14937-7");
        }
        function ZFER() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Ferritin&demo=" + RegExp.$1 + "&labType=HL7&identifier=2276-4");
        }
        function ZCA() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Calcium&demo=" + RegExp.$1 + "&labType=HL7&identifier=2000-8");
        }
        function ZPO4() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Phosphorus&demo=" + RegExp.$1 + "&labType=HL7&identifier=14879-1");
        }
        function ZPTH() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Parathyroid Hormone Intact&demo=" + RegExp.$1 + "&labType=HL7&identifier=14866-8");
        }
        function ZTSAT() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Iron Saturation&demo=" + RegExp.$1 + "&labType=HL7&identifier=14801-5");
        }
        function ZMG() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Magnesium&demo=" + RegExp.$1 + "&labType=HL7&identifier=2601-3");
        }
        function ZURIC() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Uric Acid&demo=" + RegExp.$1 + "&labType=HL7&identifier=14933-6");
        }
        function ZPSA() {
            window.open("../lab/CA/ON/labValues.jsp?testName=PSA&demo=" + RegExp.$1 + "&labType=HL7&identifier=2857-1");
        }
        function ZCEA() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Carcinoembryonic Ag&demo=" + RegExp.$1 + "&labType=HL7&identifier=2039-6");
        }
        function ZPROT() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Total Protein&demo=" + RegExp.$1 + "&labType=HL7&identifier=2885-2");
        }
        function ZGGT() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Gamma GT&demo=" + RegExp.$1 + "&labType=HL7&identifier=2324-2");
        }
        function ZANA() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Antinuclear Ab&demo=" + RegExp.$1 + "&labType=HL7&identifier=42254-3");
        }
        function ZESR() {
            window.open("../lab/CA/ON/labValues.jsp?testName=ESR&demo=" + RegExp.$1 + "&labType=HL7&identifier=4537-7");
        }
        function ZDIG() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Digoxin&demo=" + RegExp.$1 + "&labType=HL7&identifier=14698-5");
        }
        function ZdDNA() {
            window.open("../lab/CA/ON/labValues.jsp?testName=DNA Double Strand Ab&demo=" + RegExp.$1 + "&labType=HL7&identifier=32677-7");
        }
        function ZENA() {
            window.open("../lab/CA/ON/labValues.jsp?testName=ENA Screen&demo=" + RegExp.$1 + "&labType=HL7&identifier=14722-3");
        }
        function ZLITH() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Lithium&demo=" + RegExp.$1 + "&labType=HL7&identifier=14334-7");
        }
        function ZCARB() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Carbamazepine&demo=" + RegExp.$1 + "&labType=HL7&identifier=14639-9");
        }
        function ZDIL() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Phenytoin&demo=" + RegExp.$1 + "&labType=HL7&identifier=14877-5");
        }
        function ZAFP() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Alpha 1 Fetoprotein&demo=" + RegExp.$1 + "&labType=HL7&identifier=1834-1");
        }
        function ZAPOB() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Apolipoprotein B&demo=" + RegExp.$1 + "&labType=HL7&identifier=1884-6");
        }
        function ZFIT() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Occult Blood Immunochemical&demo=" + RegExp.$1 + "&labType=HL7&identifier=58453-2");
        }
        function ZTROP() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Troponin I&demo=" + RegExp.$1 + "&labType=HL7&identifier=10839-9");
        }
        function ZTTG() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Tissue Transglutaminase antibody IgA&demo=" + RegExp.$1 + "&labType=HL7&identifier=31017-7");
        }
        function ZBNP() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Natriuretic Peptide B&demo=" + RegExp.$1 + "&labType=HL7&identifier=30934-4");
        }
        function ZHAGM() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Hep A Virus antibody IgG+IgM (Total)&demo=" + RegExp.$1 + "&labType=HL7&identifier=51913-2");
        }
        function ZHIV() {
            window.open("../lab/CA/ON/labValues.jsp?testName=HIV 1+2 Ab + HIV p24 Ag (Screen)&demo=" + RegExp.$1 + "&labType=HL7&identifier=XXX-2887");
        }
        function ZHpBS() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Hep B Surface antigen (HBsAg)&demo=" + RegExp.$1 + "&labType=HL7&identifier=5195-3");
        }
        function ZHCV() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Hepatitis C Virus Ab&demo=" + RegExp.$1 + "&labType=HL7&identifier=13955-0");
        }
        function ZHPBA() {
            window.open("../lab/CA/ON/labValues.jsp?testName=Hep B Surface antibody (HBsAb)&demo=" + RegExp.$1 + "&labType=HL7&identifier=5193-8");
        }
        
        //Lab request tranfer   
        function ZDIGTF() {
        document.FormName.AdditionalTestInstructions.value += 'Digoxin level, ';
        document.FormName.PatientInstructions.value += 'Do test before taking your digoxin for that day. '; 
        }
        function ZDILTF() {
        document.FormName.AdditionalTestInstructions.value += 'Dilantin level, ';
        document.FormName.PatientInstructions.value += 'Do test before taking your dilantin for that day. '; 
        }
        function ZLITHTF() {
        document.FormName.AdditionalTestInstructions.value += 'Lithium level, ';
        document.FormName.PatientInstructions.value += 'Do test before taking your lithium for that day. '; 
        }
        function ZANATF() {
        document.FormName.AdditionalTestInstructions.value += 'ANA, ';
        }
        function ZCEATF() {
        document.FormName.AdditionalTestInstructions.value += 'CEA, ';
        }
        function ZAFPTF() {
        document.FormName.AdditionalTestInstructions.value += 'AFP, ';
        }
        function ZESRTF() {
        document.FormName.AdditionalTestInstructions.value += 'ESR, ';
        document.FormName.DiagnosisAndIndications.value += 'RO inflammatory condition '; 
        }
        function ZCRPTF() {
        document.FormName.AdditionalTestInstructions.value += 'hs CRP, ';
        }
        function ZRFTF() {
        document.FormName.AdditionalTestInstructions.value += 'RF, ';
        }
        function ZB12TF() {
        document.FormName.B12.value = 'X';
        }
        function ZURICTF() {
        document.FormName.AdditionalTestInstructions.value += 'Uric Acid, ';
        }
        function ZASTTF() {
        document.FormName.AdditionalTestInstructions.value += 'AST, ';
        }
        function ZTTGTF() {
        document.FormName.AdditionalTestInstructions.value += 'anti-TTG IgA for celiac disease, ';
        }
        function ZTROPTF() {
        document.FormName.AdditionalTestInstructions.value += 'Troponin, ';
        }
        function ZBNPTF() {
        document.FormName.AdditionalTestInstructions.value += 'BNP, ';
        }
        
        //Insert medical conditions
        function medicalConditions() {
            $("#page1").after('<input id="DMC" type="button" value="DM" class="LabP3 DoNotPrint labButton" style="left:860px;" >');
            $("#page1").after('<input id="HBPC" type="button" value="HBP" class="LabP3 DoNotPrint labButton" style="left:930px;" >');
            $("#page1").after('<input id="CHFC" type="button" value="CHF" class="LabP3 DoNotPrint labButton" style="left:1000px;" >');
            $("#page1").after('<input id="CKDC" type="button" value="CKD" class="LabP3 DoNotPrint labButton" style="left:1070px;">');
            $("#page1").after('<input id="AmioC" type="button" value="Amiodarone" class="LabP4 DoNotPrint labButton" style="left:1070px">');
            $("#page1").after('<input id="AAPsyC" type="button" value="AAPsy" class="LabP4 DoNotPrint labButton" style="left:1000px;" >');
            $("#page1").after('<input id="DigC" type="button" value="Digoxin" class="LabP4 DoNotPrint labButton" style="left:930px;">');
            $("#page1").after('<input id="MetfC" type="button" value="Metformin" class="LabP4 DoNotPrint labButton" style="left:860px;">');
            $("#page1").after('<input id="LithC" type="button" value="Lithium" class="LabP5 DoNotPrint labButton" style="left:1070px;">');
            $("#page1").after('<input id="MethoC" type="button" value="Methotrex" class="LabP5 DoNotPrint labButton" style="left:930px;">');
            $("#page1").after('<input id="PhenyC" type="button" value="Phenytoin" class="LabP5 DoNotPrint labButton" style="left:1000px;">');
            $("#page1").after('<input id="StatinC" type="button" value="Statin" class="LabP5 DoNotPrint labButton" style="left:860px;">');
            $("#page1").after('<input id="ThyrC" type="button" value="Thyroxin" class="LabP6 DoNotPrint labButton" style="left:860px;" >');
            $("#page1").after('<input id="ValproC" type="button" value="Valproate" class="LabP6 DoNotPrint labButton" style="left:1000px;">');
            $("#page1").after('<input id="AccutC" type="button" value="Accutane" class="LabP6 DoNotPrint labButton" style="left:1070px;">');
            $("#page1").after('<input id="SpiroC" type="button" value="Spironolac" class="LabP6 DoNotPrint labButton" style="left:930px;">'); 
            $("#page1").after('<input id="NOACC" type="button" value="NOAC" class="LabP6 DoNotPrint labButton" style="left:1000px;">');         
            $("#page1").after('<input id="0months" type="button" value="Due\nNow" class="DoNotPrint" style="position:absolute;left:847px;top:690px;width:40px;height:34px;cursor:pointer;background-color:yellow;" onclick="Period0();">');
            $("#page1").after('<input id="3months" type="button" value="3M" class="DoNotPrint" style="position:absolute;left:847px;top:725px;width:40px;cursor:pointer;" onclick="Period3();" title="Click twice">');
            $("#page1").after('<input id="6months" type="button" value="6M" class="DoNotPrint" style="position:absolute;left:847px;top:750px;width:40px;cursor:pointer;" onclick="Period6();" title="Click twice">');
            $("#page1").after('<input id="12months" type="button" value="12M" class="DoNotPrint" style="position:absolute;left:845px;top:775px;width:44px;cursor:pointer;" onclick="Period12();" title="Click twice">');
            $("#page1").after('<input id="INCreasefont" value="&#9650;&#9650;" type="button" class="DoNotPrint" style="position:absolute;left:842px;top:824px;width:50px;font-size:14px;text-align:center;background:yellow;" onclick="INCreaseFont();">');
            $("#page1").after('<input id="Increasefont" value="&#9650;" type="button" class="DoNotPrint" style="position:absolute;left:848px;top:847px;width:38px;font-size:14px;text-align:center;background:yellow;" onclick="IncreaseFont();">');
            $("#page1").after('<input id="increasefont" value="&#9650;" type="button" class="DoNotPrint" style="position:absolute;left:850px;top:869px;width:34px;font-size:9px;text-align:center;background:yellow;" onclick="increaseFont();">');
            $("#page1").after('<input id="decreasefont" value="&#9660;" type="button" class="DoNotPrint" style="position:absolute;left:850px;top:884px;width:34px;font-size:9px;text-align:center;background:yellow;" onclick="decreaseFont();">');
            $("#page1").after('<input id="Decreasefont" value="&#9660;" type="button" class="DoNotPrint" style="position:absolute;left:848px;top:898px;width:38px;font-size:14px;text-align:center;background:yellow;" onclick="DecreaseFont();">');           
        }
        
        // alert if any yellow check boxes
        function alertYellow(){    
        var x = $("input[type=text].yellow").val();
        if (x != "") {
        $("#0months").css("background-color", "white");
           }
        }
        
        function Period0(){
             if ($("#0months").css("background-color") == 'rgb(255, 255, 0)'){
                 checkBox();
                 $('#PatientInstructions').val($('#PatientInstructions').val() + 'Blood work is due now.').css('font-weight', '700');
             }
              if ($("#0months").css("background-color") != 'rgb(255, 255, 0)'){
             $("#12months").css("background-color", "white");
             $("#0months").css("background-color", "yellow");
             $("#3months").css("background-color", "white");
             $("#6months").css("background-color", "white");
             RepeatPopValues();
             }
             
        }
             
        function Period3(){
           var d = new Date();
           var mon = (d.getMonth() + 3);
           var months = [ "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March" ];
           var monthName = months[mon];   
              if ($("#3months").css("background-color") == 'rgb(255, 255, 0)'){
                 checkBox();
                 $('#PatientInstructions').val($('#PatientInstructions').val() + 'Blood work is due in '+monthName+'.').css('font-weight', '700');
             } 
             if ($("#3months").css("background-color") != 'rgb(255, 255, 0)'){
             $("#12months").css("background-color", "white");
             $("#3months").css("background-color", "yellow");
             $("#0months").css("background-color", "white");
             $("#6months").css("background-color", "white");
             RepeatPopValues();
             }
        }
        function Period6(){
            var d = new Date();
            var mon = (d.getMonth() + 6);
            var months = [ "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March", "April", "May", "June" ];
            var monthName = months[mon];
              if ($("#6months").css("background-color") == 'rgb(255, 255, 0)'){
                 checkBox();
                 $('#PatientInstructions').val($('#PatientInstructions').val() + 'Blood work is due in '+monthName+'.').css('font-weight', '700');
             } 
              if ($("#6months").css("background-color") != 'rgb(255, 255, 0)'){
             $("#12months").css("background-color", "white");
             $("#6months").css("background-color", "yellow");
             $("#3months").css("background-color", "white");
             $("#0months").css("background-color", "white");
             RepeatPopValues();
             }
        }
        function Period12(){
            var d = new Date();
            var mon = (d.getMonth());
            var months = [ "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December" ];
            var monthName = months[mon]; 
              if ($("#12months").css("background-color") == 'rgb(255, 255, 0)'){
                 checkBox();
                 $('#PatientInstructions').val($('#PatientInstructions').val() + 'Blood work is due next year, in '+monthName+'.').css('font-weight', '700');
             } 
              if ($("#12months").css("background-color") != 'rgb(255, 255, 0)'){
             $("#12months").css("background-color", "yellow");
             $("#6months").css("background-color", "white");
             $("#3months").css("background-color", "white");
             $("#0months").css("background-color", "white");
             RepeatPopValues();
             }
        }
    
        function INCreaseFont(){
        var fontSize = parseInt($("[name=AdditionalTestInstructions]").css("font-size"));
            fontSize = fontSize + 4 + "px";
            $("[name=AdditionalTestInstructions]").css({'font-size':fontSize});
        }
        function IncreaseFont(){
        var fontSize = parseInt($("[name=AdditionalTestInstructions]").css("font-size"));
            fontSize = fontSize + 2 + "px";
            $("[name=AdditionalTestInstructions]").css({'font-size':fontSize});
        }
        function increaseFont(){
        var fontSize = parseInt($("[name=AdditionalTestInstructions]").css("font-size"));
            fontSize = fontSize + 1 + "px";
            $("[name=AdditionalTestInstructions]").css({'font-size':fontSize});
        }
        function decreaseFont(){
        var fontSize = parseInt($("[name=AdditionalTestInstructions]").css("font-size"));
            fontSize = fontSize - 1 + "px";
            $("[name=AdditionalTestInstructions]").css({'font-size':fontSize});
        }
        function DecreaseFont(){
        var fontSize = parseInt($("[name=AdditionalTestInstructions]").css("font-size"));
            fontSize = fontSize - 2 + "px";
            $("[name=AdditionalTestInstructions]").css({'font-size':fontSize});
        }
            
        function changeSize10() {
        $("[name=AdditionalTestInstructions]").css("font-size", "10px");
        }
        function changeSize12() {
        $("[name=AdditionalTestInstructions]").css("font-size", "12px");
        }
        function changeSize14() {
        $("[name=AdditionalTestInstructions]").css("font-size", "14px");
        }
        
        function checkBox(){
            $("input[type=text].yellow").val("X");
            if (($("#DIGC").css("background-color")) == 'rgb(255, 255, 0)'){
            ZDIGTF();
            }
            if (($("#LITHC").css("background-color")) == 'rgb(255, 255, 0)'){
            ZLITHTF();
            }
            if ( (($("#GlucoseFasting").css("background-color")) == 'rgb(255, 255, 0)') ){
                document.FormName.PatientInstructions.value +=  'Nothing to eat or drink, except for water, for 8-10 hours prior to test. ';
                document.FormName.FastingTime.value='10';
            }
        }
        
        function PopKpl(result) {
              Kpl = result.value;
               Kpldate = new Date(result.date);
               var noOfMonths = monthDiff(Kpldate);
            if ( !! Kpl) {              
                $("#page1").after('<input id="KplDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:612px; top:742px" >');
                $("#page1").after('<input id="KplVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:638px; top:742px" onclick="onBodyLoad();ZK();" title="K">');
                jQ_append('#KplDate', noOfMonths + 'M', '#KplVal', Kpl);
                if (noOfMonths > 6) {
                    $("#KplDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#KplDate").css("color", "#050505");
                }
                if ((Kpl < 3.5) && (Kpl > 0)) {
                    $("#KplVal").css("color", "blue");
                }
                if (Kpl > 5) {
                    $("#KplVal").css("color", "#FF0000");
                }
            }
               PopKpl2();          
        }
        function PopKpl2(){
                var noOfMonths = monthDiff(Kpldate);
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 11)) && ((($("#HBPC").css("color")) == "rgb(255, 0, 0)") || (($("#DMC").css("color")) == "rgb(255, 0, 0)") || (($("#DigC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#Potassium").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 5)) && ((($("#LithC").css("color")) == "rgb(255, 0, 0)")||(($("#CHFC").css("color")) == "rgb(255, 0, 0)")||(($("#CKDC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#Potassium").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 2)) && (($("#SpiroC").css("color")) == "rgb(255, 0, 0)")) {
                    $("#Potassium").addClass('yellow');
                }
            }
            
        function PopNapl(result) {
             Napl = result.value;
               Napldate = new Date(result.date);
               var noOfMonths = monthDiff(Napldate);
            if ( !! Napl) {
                $("#page1").after('<input id="NaplDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:612px; top:730px;" >');
                $("#page1").after('<input id="NaplVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:638px; top:730px;" onclick="onBodyLoad();ZNA();" title="Na">');
                jQ_append('#NaplDate', noOfMonths + 'M', '#NaplVal', Napl);
                if (noOfMonths > 6) {
                    $("#NaplDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#NaplDate").css("color", "#050505");
                }
                if ((Napl < 135) && (Napl > 0)) {
                    $("#NaplVal").css("color", "blue");
                }
                if (Napl > 145) {
                    $("#NaplVal").css("color", "#FF0000");
                }
            }
               PopNapl2();         
        }
           function PopNapl2() {
               var noOfMonths = monthDiff(Napldate);
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 11)) && ((($("#HBPC").css("color")) == "rgb(255, 0, 0)") || (($("#DMC").css("color")) == "rgb(255, 0, 0)") || (($("#DigC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#Sodium").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 5)) && ((($("#LithC").css("color")) == "rgb(255, 0, 0)")||(($("#CHFC").css("color")) == "rgb(255, 0, 0)")||(($("#CKDC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#Sodium").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 2)) && (($("#SpiroC").css("color")) == "rgb(255, 0, 0)")) {
                    $("#Sodium").addClass('yellow');
                }
            }
            
        
        function PopEGFR(result) {
            var EGFR = result.value;
                EGFRdate = new Date(result.date);
            var noOfMonths = monthDiff(EGFRdate);
            if ( !! EGFR) {
                $("#page1").after('<input id="EGFRDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:763px; top:729px;" >');
                $("#page1").after('<input id="EGFRVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:789px; top:729px;" onclick="onBodyLoad();ZEGFR();" title="eGFR">');
                jQ_append('#EGFRDate', noOfMonths + 'M', '#EGFRVal', EGFR);
                if (noOfMonths > 6) {
                    $("#EGFRDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#EGFRDate").css("color", "#050505");
                }
                if ((EGFR < 60) && (EGFR > 0)) {
                    $("#EGFRVal").css("color", "blue");
                }
                if (EGFR > 200) {
                    $("#EGFRVal").css("color", "#FF0000");
                }
            }
            PopEGFR2();
        }
        function PopEGFR2(){
               var noOfMonths = monthDiff(EGFRdate);
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 11)) && ((($("#HBPC").css("color")) == "rgb(255, 0, 0)") || (($("#DMC").css("color")) == "rgb(255, 0, 0)") || (($("#DigC").css("color")) == "rgb(255, 0, 0)")||(($("#MetfC").css("color")) == "rgb(255, 0, 0)")||(($("#NOACC").css("color")) == "rgb(255, 0, 0)") )) {
                    $("#CreatinineGFR").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 5)) && ((($("#LithC").css("color")) == "rgb(255, 0, 0)")||(($("#CHFC").css("color")) == "rgb(255, 0, 0)")||(($("#CKDC").css("color")) == "rgb(255, 0, 0)") )) {
                    $("#CreatinineGFR").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 2)) && ( (($("#SpiroC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#CreatinineGFR").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 1)) && ( (($("#MethoC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#CreatinineGFR").addClass('yellow');
                }
        }

        function PopTSH(result) {
            var TSH = result.value;
            TSHdate = new Date(result.date);
            var noOfMonths = monthDiff(TSHdate);
            if ( !! TSH) {              
                $("#page1").after('<input id="TSHDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:670px; top:636px;" >');
                $("#page1").after('<input id="TSHVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:696px; top:636px;;width:43px;" onclick="onBodyLoad();ZTSH();" title="TSH">');
                jQ_append('#TSHDate', noOfMonths + 'M', '#TSHVal', TSH);
                if (noOfMonths > 6) {
                    $("#TSHDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#TSHDate").css("color", "#050505");
                }
                if ((TSH < 0.3) && (TSH > 0)) {
                    $("#TSHVal").css("color", "blue");
                }
                if (TSH > 5.5) {
                    $("#TSHVal").css("color", "#FF0000");
                }
            }
               PopTSH2();
         }          
               function PopTSH2(){
               var noOfMonths = monthDiff(TSHdate);
                if ( ((isNaN(noOfMonths)==true)||(noOfMonths > 11) )&& ((($("#ThyrC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#MonitorThyroidRx").addClass('yellow');
                }
                if ( ((isNaN(noOfMonths)==true)||(noOfMonths > 5)) && ((($("#LithC").css("color")) == "rgb(255, 0, 0)") || (($("#AmioC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#MonitorThyroidRx").addClass('yellow');
                }
        }

        function PopCA(result) {
            var CA = result.value;
            var CAdate = new Date(result.date);
            var noOfMonths = monthDiff(CAdate);
            if ( !! CA) {              
                $("#page1").after('<input id="CADate" type="text" class="LabP DoNotPrint" style="position:absolute; left:763px; top:742px" >');
                $("#page1").after('<input id="CAVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:789px; top:742px" onclick="onBodyLoad();ZCA();" title="Calcium">');
                jQ_append('#CADate', noOfMonths + 'M', '#CAVal', CA);
                if (noOfMonths > 6) {
                    $("#CADate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#CADate").css("color", "#050505");
                }
                if ((CA < 2.1) && (CA > 0)) {
                    $("#CAVal").css("color", "blue");
                }
                if (CA > 2.6) {
                    $("#CAVal").css("color", "#FF0000");
                }
            }
        }

        function PopCK(result) {
            var CK = result.value;
            var CKdate = new Date(result.date);
            var noOfMonths = monthDiff(CKdate);
            if ( !! CK) {               
                $("#page1").after('<input id="CKDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:763px; top:757px;" >');
                $("#page1").after('<input id="CKVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:789px; top:757px;" onclick="onBodyLoad();ZCK();" title="CK">');
                jQ_append('#CKDate', noOfMonths + 'M', '#CKVal', CK);
                if (noOfMonths > 6) {
                    $("#CKDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#CKDate").css("color", "#050505");
                }
                if (CK > 164) {
                    $("#CKVal").css("color", "#FF0000");
                }
            }

        }

        function PopPSA(result) {
            var PSA = result.value;
            var PSAdate = new Date(result.date);
            var noOfMonths = monthDiff(PSAdate);
            if ( !! PSA) {              
                $("#page1").after('<input id="PSADate" type="text" class="LabP DoNotPrint" style="position:absolute; left:763px; top:782px;" >');
                $("#page1").after('<input id="PSAVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:789px; top:782px;" onclick="onBodyLoad();ZPSA();" title="PSA">');
                jQ_append('#PSADate', noOfMonths + 'M', '#PSAVal', PSA);
                if (noOfMonths > 6) {
                    $("#PSADate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#PSADate").css("color", "#050505");
                }
                if (PSA > 3.9) {
                    $("#PSAVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopTCHL(result) {
            var TCHL = result.value;
                TCHLdate = new Date(result.date);
            var noOfMonths = monthDiff(TCHLdate);
            if ( !! TCHL) {               
                $("#page1").after('<input id="TCHLDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:606px; top:490px;" >');
                $("#page1").after('<input id="TCHLP" type="text" value="TC" class="LabPb DoNotPrint" style="position:absolute; left:630px; top:490px; width:17px;" >');
                $("#page1").after('<input id="TCHLVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:648px; top:490px;" onclick="onBodyLoad();ZCHOL();" title="Lipid Profile">');
                jQ_append('#TCHLDate', noOfMonths + 'M', '#TCHLVal', TCHL);
                if (noOfMonths > 6) {
                    $("#TCHLDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#TCHLDate").css("color", "#050505");
                }
                if ((TCHL < 2) && (TCHL > 0)) {
                    $("#TCHLVal").css("color", "blue");
                }
                if (TCHL > 5.2) {
                    $("#TCHLVal").css("color", "#FF0000");
                }
            }
              PopTCHL2();
        }
              function PopTCHL2(){
              var noOfMonths = monthDiff(TCHLdate);
            //If on statin do not prompt for lipid profiles
               if (( (isNaN(noOfMonths)==true)||(noOfMonths > 11)) && ((($("#DMC").css("color")) == "rgb(255, 0, 0)") && (Statin==0) )) {
                    $("#Lipid_full").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 23)) && (((($("#AAPsyC").css("color")) == "rgb(255, 0, 0)")||(($("#CKDC").css("color")) == "rgb(255, 0, 0)")) && (Statin==0))) {
                    $("#Lipid_full").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 60)) && ((($("#HBPC").css("color")) == "rgb(255, 0, 0)") && (Statin==0) )) {
                    $("#Lipid_full").addClass('yellow');
                } 
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 1000)) && ((($("#CHFC").css("color")) == "rgb(255, 0, 0)") && (Statin==0) )) {
                    $("#Lipid_full").addClass('yellow');
                }
        }
        
        function PopLDL(result) {
            var LDL = result.value;
            var LDLdate = new Date(result.date);
            if ( !! LDL) {
                var noOfMonths = monthDiff(LDLdate);
                $("#page1").after('<input id="LDLDate" type="text" class="LabPb DoNotPrint" style="position:absolute; left:673px; top:490px;" >');
                $("#page1").after('<input id="LDLVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:683px; top:490px;" onclick="onBodyLoad();ZLDL();" >');
                jQ_append('#LDLDate', 'L', '#LDLVal', LDL);
                if ((LDL < 1.5) && (LDL > 0)) {
                    $("#LDLVal").css("color", "blue");
                }
                if (LDL > 3.4) {
                    $("#LDLVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopHDL(result) {
            var HDL = result.value;
            var HDLdate = new Date(result.date);
            if ( !! HDL) {
                var noOfMonths = monthDiff(HDLdate);
                $("#page1").after('<input id="HDLDate" type="text" class="LabPb DoNotPrint" style="position:absolute; left:708px; top:490px;" >');
                $("#page1").after('<input id="HDLVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:718px; top:490px;" onclick="onBodyLoad();ZHDL();" >');
                jQ_append('#HDLDate', 'H', '#HDLVal', HDL);
                if ((HDL < 0.9) && (HDL > 0)) {
                    $("#HDLVal").css("color", "blue");
                }
            }
        }
        
        function PopTCHD(result) {
            var TCHD = result.value;
            var TCHDdate = new Date(result.date);
            if ( !! TCHD) {
                var noOfMonths = monthDiff(TCHDdate);
                $("#page1").after('<input id="TCHDDate" type="text" class="LabPb DoNotPrint" style="position:absolute; left:743px; top:490px;" >');
                $("#page1").after('<input id="TCHDVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:753px; top:490px;" onclick="onBodyLoad();ZRATI();" >');
                jQ_append('#TCHDDate', 'R', '#TCHDVal', TCHD);
                if (TCHD > 4.9) {
                    $("#TCHDVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopTG(result) {
            var TG = result.value;
            var TGdate = new Date(result.date);
            if ( !! TG) {
                var noOfMonths = monthDiff(TGdate);
                $("#page1").after('<input id="TGDate" type="text" class="LabPb DoNotPrint" style="position:absolute; left:778px; top:490px;" >');
                $("#page1").after('<input id="TGVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:788px; top:490px;" onclick="onBodyLoad();ZTRIG();" >');
                jQ_append('#TGDate', 'T', '#TGVal', TG);
                if (TG > 2.3) {
                    $("#TGVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopFBS(result) {
            var FBS = result.value;
                FBSdate = new Date(result.date);
            var noOfMonths = monthDiff(FBSdate);
            if ( !! FBS) {               
                $("#page1").after('<input id="FBSDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:790px; top:375px" >');
                $("#page1").after('<input id="FBSVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:814px; top:375px" onclick="onBodyLoad();ZFBS();" title="FBS" >');
                jQ_append('#FBSDate', noOfMonths + 'M', '#FBSVal', FBS);
                if (noOfMonths > 6) {
                    $("#FBSDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#FBSDate").css("color", "#050505");
                }
                if ((FBS < 3.6) && (FBS > 0)) {
                    $("#FBSVal").css("color", "blue");
                }
                if (FBS > 5.5) {
                    $("#FBSVal").css("color", "#FF0000");
                }
            }
            PopFBS2();
        }
            function PopFBS2(){
            var noOfMonths = monthDiff(FBSdate);
                if ( ((isNaN(noOfMonths)==true)||(noOfMonths > 1000)) && ((($("#CHFC").css("color")) == "rgb(255, 0, 0)")) ) {
                    $("#GlucoseFasting").addClass('yellow');
                } 
               /* if (( (isNaN(noOfMonths)==true)||(noOfMonths > 11)) && (Statin==0) && ((($("#CKDC").css("color")) == "rgb(255, 0, 0)") || (($("#HBPC").css("color")) == "rgb(255, 0, 0)") || (($("#AAPsyC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#GlucoseFasting").addClass('yellow');
                }   */          
        }
        
        function PopRBS(result) {
            var RBS = result.value;
            	RBSdate = new Date(result.date);
            var noOfMonths = monthDiff(RBSdate);
            if ( !! RBS) {
                $("#page1").after('<input id="RBSDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:660px; top:389px;" >');
                $("#page1").after('<input id="RBSVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:686px; top:389px;" onclick="onBodyLoad();ZRBS();" title="RBS">');
                jQ_append('#RBSDate', noOfMonths + 'M', '#RBSVal', RBS);
                if (noOfMonths > 6) {
                    $("#RBSDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#RBSDate").css("color", "#050505");
                }
                if ((RBS < 11.0) && (RBS > 0)) {
                    $("#RBSVal").css("color", "blue");
                }
                if (RBS > 11.1) {
                    $("#RBSVal").css("color", "#FF0000");
                }
			}
            PopRBS2();
         }
            function PopRBS2(){
            var noOfMonths = monthDiff(RBSdate);
                if ( ((isNaN(noOfMonths)==true)||(noOfMonths > 1000)) && ((($("#CHFC").css("color")) == "rgb(255, 0, 0)")) ) {
                    $("#GlucoseRandom").addClass('yellow');
                } 
        }

        function PopA1C(result) {
            var A1C = result.value;
             A1Cdate = new Date(result.date);
            var noOfMonths = monthDiff(A1Cdate);
            if ( !! A1C) {              
                $("#page1").after('<input id="A1CDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:740px; top:458px" >');
                $("#page1").after('<input id="A1CVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:766px; top:458px" onclick="onBodyLoad();ZA1C();" title="A1c">');
                jQ_append('#A1CDate', noOfMonths + 'M', '#A1CVal', A1C);
                if (noOfMonths > 6) {
                    $("#A1CDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#A1CDate").css("color", "#050505");
                }
                if ((A1C < 4) && (A1C > 0)) {
                    $("#A1CVal").css("color", "blue");
                }
                if (A1C > 6.2) {
                    $("#A1CVal").css("color", "#FF0000");
                }
            }
               PopA1C2();
            }
            function PopA1C2(){
            var noOfMonths = monthDiff(A1Cdate);
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 11))  && ((($("#CKDC").css("color")) == "rgb(255, 0, 0)") || (($("#HBPC").css("color")) == "rgb(255, 0, 0)") || (($("#AAPsyC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#A1c").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 5)) && ((($("#DMC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#A1c").addClass('yellow');
                }        
        }
        
        function PopACR(result) {
            var ACR = result.value;
             ACRdate = new Date(result.date);
            var noOfMonths = monthDiff(ACRdate);
            if ( !! ACR) {               
                $("#page1").after('<input id="ACRDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:740px; top:473px" >');
                $("#page1").after('<input id="ACRVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:766px; top:473px" onclick="onBodyLoad();ZACR();" title="ACR">');
                jQ_append('#ACRDate', noOfMonths + 'M', '#ACRVal', ACR);
                if (noOfMonths > 6) {
                    $("#ACRDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#ACRDate").css("color", "#050505");
                }
                if (ACR > 3) {
                    $("#ACRVal").css("color", "#FF0000");
                }
            }
               PopACR2();
            }
            function PopACR2() {
            var noOfMonths = monthDiff(ACRdate);
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 11)) && ( (($("#DMC").css("color")) == 'red')||((($("#CKDC").css("color")) == "rgb(255, 0, 0)")) )) {
                    $("#ACR").addClass('yellow');
                }            
        }
        
        function PopFER(result) {
            var FER = result.value;
            var FERdate = new Date(result.date);
            var noOfMonths = monthDiff(FERdate);
            if ( !! FER) {              
                $("#page1").after('<input id="FERDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:140px; top:407px;" >');
                $("#page1").after('<input id="FERVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:162px; top:407px;" onclick="onBodyLoad(); ZFER();" title="Ferritin">');
                jQ_append('#FERDate', noOfMonths + 'M', '#FERVal', FER);
                if (noOfMonths > 6) {
                    $("#FERDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#FERDate").css("color", "#050505");
                }
                if ((FER < 15) && (FER > 0)) {
                    $("#FERVal").css("color", "blue");
                }
                if (FER > 160) {
                    $("#FERVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopHb(result) {
            var Hb = result.value;
             Hbdate = new Date(result.date);
            var noOfMonths = monthDiff(Hbdate);
            if ( !! Hb) {               
                $("#page1").after('<input id="HbDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:0px; top:359px" >');
                $("#page1").after('<input id="HbSpace" type="text" value="H" class="LabPb DoNotPrint" style="position:absolute; left:30px; top:359px" >');
                $("#page1").after('<input id="HbVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:40px; top:359px" onclick="onBodyLoad();ZHB();" title="Hgb">');
                jQ_append('#HbDate', noOfMonths + 'M', '#HbVal', Hb);
                if (noOfMonths > 6) {
                    $("#HbDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#HbDate").css("color", "#050505");
                }
                if ((Hb < 115) && (Hb > 0)) {
                    $("#HbVal").css("color", "blue");
                }
                if (Hb > 160) {
                    $("#HbVal").css("color", "#FF0000");
                }
            } 
               PopHb2();
            }
            function PopHb2() {
            var noOfMonths = monthDiff(Hbdate);
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 1000)) && ((($("#CHFC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#HematologyProfile").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 11)) && ((($("#CKDC").css("color")) == "rgb(255, 0, 0)") || (($("#ValproC").css("color")) == "rgb(255, 0, 0)") || (($("#MetfC").css("color")) == "rgb(255, 0, 0)")||(($("#PhenyC").css("color")) == "rgb(255, 0, 0)") )) {
                    $("#HematologyProfile").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 5)) && ((($("#LithC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#HematologyProfile").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 2)) && ((($("#MethoC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#HematologyProfile").addClass('yellow');
                }
        }
        
        function PopWCC(result) {
            var WCC = result.value;
            var WCCdate = new Date(result.date);
            if ( !! WCC) {
                var noOfMonths = monthDiff(WCCdate);
                $("#page1").after('<input id="WCCDate" type="text" class="LabPb DoNotPrint" style="position:absolute; left:70px; top:359px" >');
                $("#page1").after('<input id="WCCVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:80px; top:359px" onclick="onBodyLoad();ZWBC();" title="WBC">');
                jQ_append('#WCCDate', 'W', '#WCCVal', WCC);
                if (WCC > 11) {
                    $("#WCCVal").css("color", "#FF0000");
                }
            }
        }
            
        function PopPLT(result) {
            var PLT = result.value;
            var PLTdate = new Date(result.date);
            if ( !! PLT) {
                var noOfMonths = monthDiff(PLTdate);
                $("#page1").after('<input id="PLTDate" type="text" class="LabPb DoNotPrint" style="position:absolute; left:190px; top:359px" >');
                $("#page1").after('<input id="PLTVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:200px; top:359px" onclick="onBodyLoad();ZPLT();" title="Plt">');
                jQ_append('#PLTDate', 'P', '#PLTVal', PLT);
                if (PLT > 400) {
                    $("#PLTVal").css("color", "#FF0000");
                }
                if ((PLT < 150) && (PLT > 0)) {
                    $("#PLTVal").css("color", "blue");
                }
            }
        }
        
        function PopALB(result) {
            var ALB = result.value;
             ALBdate = new Date(result.date);
            var noOfMonths = monthDiff(ALBdate);
            if ( !! ALB) {
                $("#page1").after('<input id="ALBDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:612px; top:754px" >');
                $("#page1").after('<input id="ALBVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:638px; top:754px" onclick="onBodyLoad();ZALB();" title="Albumin">');
                jQ_append('#ALBDate', noOfMonths + 'M', '#ALBVal', ALB);
                if (noOfMonths > 6) {
                    $("#ALBDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#ALBDate").css("color", "#050505");
                }
                if ((ALB < 35) && (ALB > 0)) {
                    $("#ALBVal").css("color", "blue");
                }
                if (ALB > 50) {
                    $("#ALBVal").css("color", "#FF0000");
                }
            } 
                PopALB2();
            }
            function PopALB2() {
            var noOfMonths = monthDiff(ALBdate);
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 1000)) && (($("#CHFC").css("color")) == "rgb(255, 0, 0)") ) {
                    $("#ALB").addClass('yellow');
                }           
        }
        
        function PopALP(result) {
            var ALP = result.value;
            var ALPdate = new Date(result.date);
            var noOfMonths = monthDiff(ALPdate);
            if ( !! ALP) {
                $("#page1").after('<input id="ALPDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:612px; top:766px" >');
                $("#page1").after('<input id="ALPVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:638px; top:766px" onclick="onBodyLoad();ZALP();" title="Alk Phos">');
                jQ_append('#ALPDate', noOfMonths + 'M', '#ALPVal', ALP);
                if (noOfMonths > 6) {
                    $("#ALPDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#ALPDate").css("color", "#050505");
                }
                if ((ALP < 35) && (ALP > 0)) {
                    $("#ALPVal").css("color", "blue");
                }
                if (ALP > 105) {
                    $("#ALPVal").css("color", "#FF0000");
                }
            } 
                            
        }
        
        function PopALT(result) {
            var ALT = result.value;
             ALTdate = new Date(result.date);
            var noOfMonths = monthDiff(ALTdate);
            if ( !! ALT) {               
                $("#page1").after('<input id="ALTDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:612px; top:778px;" >');
                $("#page1").after('<input id="ALTVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:638px; top:778px;" onclick="onBodyLoad();ZALT();" title="ALT">');
                jQ_append('#ALTDate', noOfMonths + 'M', '#ALTVal', ALT);
                if (noOfMonths > 6) {
                    $("#ALTDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#ALTDate").css("color", "#050505");
                }
                if (ALT > 49) {
                    $("#ALTVal").css("color", "#FF0000");
                }
            }
               PopALT2();
            }
            function PopALT2() {
            var noOfMonths = monthDiff(ALTdate);
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 1000)) && (($("#CHFC").css("color")) == "rgb(255, 0, 0)") ) {
                    $("#ALT").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 11)) && ( (($("#ValproC").css("color")) == "rgb(255, 0, 0)")||(($("#PhenyC").css("color")) == "rgb(255, 0, 0)") )) {
                    $("#ALT").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 5)) && ((($("#AmioC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#ALT").addClass('yellow');
                }
                if (( (isNaN(noOfMonths)==true)||(noOfMonths > 2)) && ((($("#MethoC").css("color")) == "rgb(255, 0, 0)")||(($("#AccutC").css("color")) == "rgb(255, 0, 0)") )) {
                    $("#ALT").addClass('yellow');
                }               
        }
        
        function PopVB12(result) {
            var VB12 = result.value;
            var VB12date = new Date(result.date);
            var noOfMonths = monthDiff(VB12date);
              if ( !! VB12) {  
               $("#page1").after('<input id="VB12Date" type="text" class="LabP DoNotPrint" style="position:absolute; left:612px; top:790px" >');
                $("#page1").after('<input id="VB12Val" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:638px; top:790px" onclick="onBodyLoad();ZB12();" title="Vit B12">');
                 jQ_append('#VB12Date', noOfMonths + 'M', '#VB12Val', VB12);
                if (noOfMonths > 6) {
                    $("#VB12Date").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#VB12Date").css("color", "#050505");
                }
                if ((VB12 < 150) && (VB12 > 0)) {
                    $("#VB12Val").css("color", "blue");
                }
                if (VB12 > 500) {
                    $("#VB12Val").css("color", "#FF0000");
                }
            }
        }
        
        function PopBILI(result) {
            var BILI = result.value;
            var BILIdate = new Date(result.date);
            var noOfMonths = monthDiff(BILIdate);
            if ( !! BILI) {               
                $("#page1").after('<input id="BILIDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:612px; top:802px" >');
                $("#page1").after('<input id="BILIVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:638px; top:802px" onclick="onBodyLoad();ZBILI();" title="Bili">');
                jQ_append('#BILIDate', noOfMonths + 'M', '#BILIVal', BILI);
                if (noOfMonths > 6) {
                    $("#BILIDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#BILIDate").css("color", "#050505");
                }
                if (BILI > 17) {
                    $("#BILIVal").css("color", "#FF0000");
                }
            }                           
        }
        
        function PopGGT(result) {
            var GGT = result.value;
            var GGTdate = new Date(result.date);
            var noOfMonths = monthDiff(GGTdate);
            if ( !! GGT) {
                $("#page1").after('<input id="GGTDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:612px; top:815px" >');
                $("#page1").after('<input id="GGTVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:638px; top:815px" onclick="onBodyLoad();ZGGT();" title="GGT">');
                jQ_append('#GGTDate', noOfMonths + 'M', '#GGTVal', GGT);
                if (noOfMonths > 6) {
                    $("#GGTDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#GGTDate").css("color", "#050505");
                }
                if (GGT > 30) {
                    $("#GGTVal").css("color", "#FF0000");
                }
            }            
        }
        
        function PopPROT(result) {
            var PROT = result.value;
            var PROTdate = new Date(result.date);
            var noOfMonths = monthDiff(PROTdate);
            if ( !! PROT) {
                $("#page1").after('<input id="PROTDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:612px; top:827px" >');
                $("#page1").after('<input id="PROTVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:638px; top:827px" onclick="onBodyLoad();ZPROT();" title="T Protein">');
                jQ_append('#PROTDate', noOfMonths + 'M', '#PROTVal', PROT);
                if (noOfMonths > 6) {
                    $("#PROTDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#PROTDate").css("color", "#050505");
                }
                if ((PROT < 50) && (PROT > 0)) {
                    $("#PROTVal").css("color", "blue");
                }
                if (PROT > 80) {
                    $("#PROTVal").css("color", "#FF0000");
                }
            }            
        }
        
        function PopURIC(result) {
            var URIC = result.value;
            var URICdate = new Date(result.date);
            var noOfMonths = monthDiff(URICdate);
               if ( !! URIC) {
               jQ_append('#URICDate', noOfMonths + 'M', '#URICVal', URIC);
                if (noOfMonths > 6) {
                    $("#URICDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#URICDate").css("color", "#050505");
                }
                if ((URIC < 140) && (URIC > 0)) {
                    $("#URICVal").css("color", "blue");
                }
                if (URIC > 360) {
                    $("#URICVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopAST(result) {
            var AST = result.value;
            var ASTdate = new Date(result.date);
            var noOfMonths = monthDiff(ASTdate);
             if ( !! AST) {               
                jQ_append('#ASTDate', noOfMonths + 'M', '#ASTVal', AST);
                if (noOfMonths > 6) {
                    $("#ASTDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#ASTDate").css("color", "#050505");
                }
                if (AST > 35) {
                    $("#ASTVal").css("color", "#FF0000");
                }
            }
        }
    
        function PopCRP(result) {
            var CRP = result.value;
            var CRPdate = new Date(result.date);
            var noOfMonths = monthDiff(CRPdate);
             if ( !! CRP) {              
                jQ_append('#CRPDate', noOfMonths + 'M', '#CRPVal', CRP);
                if (noOfMonths > 6) {
                    $("#CRPDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#CRPDate").css("color", "#050505");
                }
                if (CRP > 10) {
                    $("#CRPVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopESR(result) {
            var ESR = result.value;
            var ESRdate = new Date(result.date);
            var noOfMonths = monthDiff(ESRdate);
                if ( !! ESR) {
                jQ_append('#ESRDate', noOfMonths + 'M', '#ESRVal', ESR);
                if (noOfMonths > 6) {
                    $("#ESRDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#ESRDate").css("color", "#050505");
                }
                if (ESR > 33) {
                    $("#ESRVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopRF(result) {
            var RF = result.value;
            var RFdate = new Date(result.date);
            var noOfMonths = monthDiff(RFdate);
            if ( !! RF) {                
                jQ_append('#RFDate', noOfMonths + 'M', '#RFVal', RF);
                if (noOfMonths > 6) {
                    $("#RFDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#RFDate").css("color", "#050505");
                }
                if (RF > 29) {
                    $("#RFVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopANA(result) {
            var ANA = result.value;
            var ANAdate = new Date(result.date);
            var noOfMonths = monthDiff(ANAdate);
            if ( !! ANA) {                
                jQ_append('#ANADate', noOfMonths + 'M', '#ANAVal', ANA);
                if (noOfMonths > 6) {
                    $("#ANADate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#ANADate").css("color", "#050505");
                }
                if (ANA =='Positive') {
                    $("#ANAVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopCEA(result) {
            var CEA = result.value;
            var CEAdate = new Date(result.date);
            var noOfMonths = monthDiff(CEAdate);
            if ( !! CEA) {                
                jQ_append('#CEADate', noOfMonths + 'M', '#CEAVal', CEA);
                if (noOfMonths > 6) {
                    $("#CEADate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#CEADate").css("color", "#050505");
                }
                if (CEA > 3.9) {
                    $("#CEAVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopAFP(result) {
            var AFP = result.value;
            var AFPdate = new Date(result.date);
            var noOfMonths = monthDiff(AFPdate);
            if ( !! AFP) {                  
                jQ_append('#AFPDate', noOfMonths + 'M', '#AFPVal', AFP);
                if (noOfMonths > 6) {
                    $("#AFPDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#AFPDate").css("color", "#050505");
                }
                if (AFP > 3.9) {
                    $("#AFPVal").css("color", "#FF0000");
                }
            }
            alertYellow();
        }
        
        function PopDIG(result) {
            var DIG = result.value;
             DIGdate = new Date(result.date);
            var noOfMonths = monthDiff(DIGdate);
             if ( !! DIG) {               
                jQ_append('#DIGDate', noOfMonths + 'M', '#DIGVal', DIG);
                if (noOfMonths > 6) {
                    $("#DIGDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#DIGDate").css("color", "#050505");
                }
                if (DIG > 2.0) {
                    $("#DIGVal").css("color", "#FF0000");
                }
            }
                PopDIG2();
            }
            function PopDIG2() {
            var noOfMonths = monthDiff(DIGdate);
            if (( (isNaN(noOfMonths)==true)||(noOfMonths > 11)) && ((($("#DigC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#DIGC").addClass('yellow');
                }
        }
        
        function PopDIL(result) {
            var DIL = result.value;
            var DILdate = new Date(result.date);
            var noOfMonths = monthDiff(DILdate);
            if ( !! DIL) {               
               jQ_append('#DILDate', noOfMonths + 'M', '#DILVal', DIL);
                if (noOfMonths > 6) {
                    $("#DILDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#DILDate").css("color", "#050505");
                }
                if (DIL > 80) {
                    $("#DILVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopLITH(result) {
            var LITH = result.value;
            LITHdate = new Date(result.date);
            var noOfMonths = monthDiff(LITHdate);
            if ( !! LITH) {                 
                jQ_append('#LITHDate', noOfMonths + 'M', '#LITHVal', LITH);
                if (noOfMonths > 6) {
                    $("#LITHDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#LITHDate").css("color", "#050505");
                }
                if (LITH > 1.2) {
                    $("#LITHVal").css("color", "#FF0000");
                }
            }
               PopLITH2();
            }
            function PopLITH2() {
            var noOfMonths = monthDiff(LITHdate);
            if (( (isNaN(noOfMonths)==true)||(noOfMonths > 5)) && ((($("#LithC").css("color")) == "rgb(255, 0, 0)"))) {
                    $("#LITHC").addClass('yellow');
                }
        }

        function PopHpBS(result) {
            var HpBS = result.value;
            var HpBSdate = new Date(result.date);
            var noOfMonths = monthDiff(HpBSdate);
            if ( !! HpBS) {     
                $("#page1").after('<input id="HpBSDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:355px; top:677px" >');
                $("#page1").after('<input id="HpBSVal" type="text" class="LabP2 DoNotPrint" style="position:absolute; left:381px; top:677px; width:75px;" title="HBsAg">');
                jQ_append('#HpBSDate', noOfMonths + 'M', '#HpBSVal', HpBS);
                if (noOfMonths > 6) {
                    $("#HpBSDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#HpBSDate").css("color", "#050505");
                }
                if (HpBS == "Reactive") {
                    $("#HpBSVal").css("color", "#FF0000");
                }
            }
        }

        function PopHpCA(result) {
            var HpCA = result.value;
            var HpCAdate = new Date(result.date);
            var noOfMonths = monthDiff(HpCAdate);
            if ( !! HpCA) {              
                $("#page1").after('<input id="HpCADate" type="text" class="LabP DoNotPrint" style="position:absolute; left:405px; top:591px;" >');
                $("#page1").after('<input id="HpCAVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:431px; top:591px; width:70px;" title="HCV Ab" onclick="onBodyLoad();ZHCV();">');
                jQ_append('#HpCADate', noOfMonths + 'M', '#HpCAVal', HpCA);
                if (noOfMonths > 6) {
                    $("#HpCADate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#HpCADate").css("color", "#050505");
                }
                if (HpCA == "Reactive") {
                    $("#HpCAVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopHAGM(result) {
            var HAGM = result.value;
            var HAGMdate = new Date(result.date);
            var noOfMonths = monthDiff(HAGMdate);
            if ( !! HAGM) {              
                $("#page1").after('<input id="HAGMDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:410px; top:627px;" >');
                $("#page1").after('<input id="HAGMVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:436px; top:627px; width:130px;" title="HAV total" onclick="onBodyLoad();ZHAGM();">');
                jQ_append('#HAGMDate', noOfMonths + 'M', '#HAGMVal', HAGM);
                if (noOfMonths > 6) {
                    $("#HAGMDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#HAGMDate").css("color", "#050505");
                }
//                if (HAGM == "Reactive") {
//                    $("#HAGMVal").css("color", "#FF0000");
//                }
            }
        }

        function PopHPBA(result) {
            var HPBA = result.value;
            var HPBAdate = new Date(result.date);
            var noOfMonths = monthDiff(HPBAdate);
            if ( !! HPBA) {              
                $("#page1").after('<input id="HPBADate" type="text" class="LabP DoNotPrint" style="position:absolute; left:410px; top:642px;" >');
                $("#page1").after('<input id="HPBAVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:436px; top:642px; width:140px;" title="HBsAb titre" onclick="onBodyLoad();ZHPBA();" >');
                jQ_append('#HPBADate', noOfMonths + 'M', '#HPBAVal', HPBA);
                if (noOfMonths > 6) {
                    $("#HPBADate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#HPBADate").css("color", "#050505");
                }
                if (HPBA > 10) {
                    $("#HPBAVal").css("color", "#FF0000");
                }
            }
        }

        function PopHIV(result) {
            var HIV = result.value;
            var HIVdate = new Date(result.date);
            var noOfMonths = monthDiff(HIVdate);
            if ( !! HIV) {              
                $("#page1").after('<input id="HIVDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:380px; top:712px;" >');
                $("#page1").after('<input id="HIVVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:406px; top:712px; width:70px;" title="HIV Ab" onclick="onBodyLoad();ZHIV();" >');
                jQ_append('#HIVDate', noOfMonths + 'M', '#HIVVal', HIV);
                if (noOfMonths > 6) {
                    $("#HIVDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#HIVDate").css("color", "#050505");
                }
                if (HIV == "Reactive") {
                    $("#HIVVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopINR(result) {
            var INR = result.value;
            var INRdate = new Date(result.date);
            var noOfMonths = monthDiff(INRdate);
            if ( !! INR) {
                $("#page1").after('<input id="INRDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:70px; top:393px" >');
                $("#page1").after('<input id="INRVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:92px; top:393px" onclick="onBodyLoad();ZINR();" title="INR">');
                jQ_append('#INRDate', noOfMonths + 'M', '#INRVal', INR);
                if (noOfMonths > 6) {
                    $("#INRDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#INRDate").css("color", "#050505");
                }
                if ((INR < 2) && (INR > 0)) {
                    $("#INRVal").css("color", "blue");
                }
                if (INR > 3) {
                    $("#INRVal").css("color", "#FF0000");
                }
            }            
        }
    
        function PopAPOB(result) {
            var APOB = result.value;
            var APOBdate = new Date(result.date);
            var noOfMonths = monthDiff(APOBdate);
            if ( !! APOB) {              
                $("#page1").after('<input id="APOBDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:730px; top:617px" >');
                $("#page1").after('<input id="APOBVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:756px; top:617px" onclick="onBodyLoad();ZAPOB();" title="ApoB">');
                jQ_append('#APOBDate', noOfMonths + 'M', '#APOBVal', APOB);
                if (noOfMonths > 6) {
                    $("#APOBDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#APOBDate").css("color", "#050505");
                }
                if (APOB >= 0.8) {
                    $("#APOBVal").css("color", "#FF0000");
                }
            }
        }    
        
          function PopFIT(result) {
            var FIT = result.value;
             FITdate = new Date(result.date);
             age = parseFloat(document.getElementById("PatientAge").value); 
             var noOfMonths = monthDiff(FITdate);
            
            if ( !! FIT) {
                $("#page1").after('<input id="FITSpace" type="text" value="FIT" class="LabPb DoNotPrint" style="position:absolute; left:700px; top:844px; width:25px;" >');
                $("#page1").after('<input id="FITDate" type="text" class="LabP DoNotPrint" style="position:absolute; left:725px; top:844px;" >');
                $("#page1").after('<input id="FITVal" type="text" class="LabP2 DoNotPrint labButton4" style="position:absolute; left:755px; top:844px;" onclick="onBodyLoad();ZFIT();" title="FIT">');           
                jQ_append('#FITDate',noOfMonths + 'M', '#FITVal', FIT);
                if (noOfMonths > 6) {
                    $("#FITDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#FITDate").css("color", "#050505");
                }
                if (FIT > 49) {
                    $("#FITVal").css("color", "#FF0000");
                }
            }
            PopFIT2();
        }
            function PopFIT2(){
            var NextDate = $('#FUYear').val();
            var TodaysYear = new Date().getFullYear();
            var YearDiff = (NextDate-TodaysYear);
            var noOfMonths = monthDiff(FITdate);

        //    var FITV = $('#FUFITCB').val();
        //   var ColoV = $('#FUColonoscopyCB').val();

            if (! NextDate) {           
                    if (((isNaN(noOfMonths)==true)||(noOfMonths > 24))&&(age>=50)&&(age<=74)) {
                         $("#FIT_CSP").addClass('yellow');
                    }
                }

        //    if ((YearDiff < 0)&&(! ColoV)) {            
        //            if (((isNaN(noOfMonths)==true)||(noOfMonths > 24))&&(age>=50)&&(age<=74)) {
        //                 $("#FIT_CSP").addClass('yellow');
        //            }
        //        }

            if ((!! NextDate)&&(YearDiff < 0)) {            
                         $("#FUYear").addClass('yellow');
                }
        }
            
            function PopTTG(result) {
            var TTG = result.value;
            var TTGdate = new Date(result.date);
            var noOfMonths = monthDiff(TTGdate);
              if ( !! TTG) {  
                jQ_append('#TTGDate', noOfMonths + 'M', '#TTGVal', TTG);
                if (noOfMonths > 6) {
                    $("#TTGDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#TTGDate").css("color", "#050505");
                }
                if (TTG > 20) {
                    $("#TTGVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopTROP(result) {
            var TROP = result.value;
            var TROPdate = new Date(result.date);
            var noOfMonths = monthDiff(TROPdate);
              if ( !! TROP) {  
                jQ_append('#TROPDate', noOfMonths + 'M', '#TROPVal', TROP);
                if (noOfMonths > 6) {
                    $("#TROPDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#TROPDate").css("color", "#050505");
                }
                if (TROP >= 0.06) {
                    $("#TROPVal").css("color", "#FF0000");
                }
            }
        }
        
        function PopBNP(result) {
            var BNP = result.value;
            var BNPdate = new Date(result.date);
            var noOfMonths = monthDiff(BNPdate);
              if ( !! BNP) {  
                jQ_append('#BNPDate', noOfMonths + 'M', '#BNPVal', BNP);
                if (noOfMonths > 6) {
                    $("#BNPDate").css("color", "#030303");
                }
                if (noOfMonths > 12) {
                    $("#BNPDate").css("color", "#050505");
                }
                if (BNP >= 100) {
                    $("#BNPVal").css("color", "#FF0000");
                }
            }
        }

        
        function DMLipid(){
         var FreeText = /STATIN/i;
         var match = allRx.search(FreeText);
         if(match == -1){                    //not on statin
            $('#Lipid_full').val('X');
        }
    }   
        
//Peters Code
        function StartAddIfMissingTitle(x,content){
            document.getElementById(x).title = content
}

        function AddIfMissingTitle(x,content){
    if (document.getElementById(x).title.indexOf(content)==-1){
            document.getElementById(x).title += content
    }
}

function AddIfMissingStyle(x,content){
    if (document.getElementById(x).style.cssText.indexOf(content)==-1){
            document.getElementById(x).style.cssText += "; "+content
    }
}

function AddIfMissingHTML(x,content, test){
    if (document.getElementById(x).innerHTML.indexOf(test)==-1){
            document.getElementById(x).innerHTML += content
    }
}

function hilite(me){
     document.getElementById(me).style.color = 'red';
}

function getLines(x){
    var multi=document.getElementById(x).value ;
    var lines=multi.split("\n");
    var numLines=lines.length;
    return numLines;
}


function getLabAge(DateId){
    var num_months = 1200;
    //"2012-12-06 00:00:00"
    var strDate=document.getElementById(DateId).value ;
    if (strDate.length >9) {
        var dateParts = (strDate.substring(0,10)).split("-");
        var date = new Date(dateParts[0], (dateParts[1] - 1), dateParts[2]);
        var today= new Date();
        var milli_today=today.getTime();
        var milli_date=date.getTime();
        var diff = milli_today - milli_date;
        num_months = Math.round(diff/2628000000); //(((diff / 1000)s / 60)m / 60)h / 24d / 365y * 12m
    } else {
        document.getElementById(DateId).value="?" ;
    }
    return num_months;
}

function Framingham1991(age, female, smoking, systolic, lipid_ratio, predict_length) {  
    var chd_theta0      = 0.9145;
    var chd_theta1      = -0.2784;
    var chd_b0      = 15.5305;
    var chd_b1      = 28.4441;  // female
    var chd_b2      = -1.4792;  // log(age)
    var chd_b3      = 0;        // log(age)^2
    var chd_b4      = -14.4588; // log(age)*sex
    var chd_b5      = 1.8515;   // log(age)^2*sex
    var chd_b6      = -0.9119;  // log(SPB)
    var chd_b7      = -0.2767;  // smoking
    var chd_b8      = -0.7181;  // log(total_c/hdl_c)
 
    var chd_b1out = chd_b1 * female;
    var chd_b2out = chd_b2 * Math.log(age);
    var chd_b3out = chd_b3 * Math.log(age) * Math.log(age);
    var chd_b4out = chd_b4 * Math.log(age) * female;
    var chd_b5out = chd_b5 * Math.log(age) * Math.log(age) * female;
    var chd_b6out = chd_b6 * Math.log(systolic);
    var chd_b7out = chd_b7 * smoking;
    var chd_b8out = chd_b8 * Math.log(lipid_ratio);
 
    var mean = chd_b0 + chd_b1out + chd_b2out + chd_b3out + chd_b4out + chd_b5out + chd_b6out + chd_b7out + chd_b8out;
 
    var log_var = chd_theta0 + chd_theta1 * mean;
 
    var u = (Math.log(predict_length) - mean ) / Math.exp(log_var);
 
    chd_risk = (1.0 - Math.exp( -Math.exp( u ) )) * 0.75;  // the calculation is the simpler 1991 Framingham which is 20-30% high
 
    return chd_risk;
}

// function GetFraminghamCHDRiskPoints(age, sex, smoking, systolic, treated_bp, total_chol, hdl_chol)

function GetFraminghamCHDRiskPoints(age, female, smoking, systolic, treated_bp, chol, hdl_chol){            

    var age_points = 0;
    
    if ( age >= 20 && age <= 34 )
    {
        age_points = (female == 1) ? -7 : -9;
    }
    else if ( age <= 39 )
    {
        age_points = (female == 1) ? -3 : -4;
    }
    else if ( age <= 44 )
    {
        age_points = (female == 1) ? 0 : 0;
    }
    else if ( age <= 49 )
    {
        age_points = (female == 1) ? 3 : 3;
    }
    else if ( age <= 54 )
    {
        age_points = (female == 1) ? 6 : 6;
    }
    else if ( age <= 59 )
    {
        age_points = (female == 1) ? 8 : 8;
    }
    else if ( age <= 64 )
    {
        age_points = (female == 1) ? 10 : 10;
    }
    else if ( age <= 69 )
    {
        age_points = (female == 1) ? 12 : 11;
    }
    else if ( age <= 74 )
    {
        age_points = (female == 1) ? 14 : 12;
    }
    else if ( age <= 79 )
    {
        age_points = (female == 1) ? 16 : 13;
    }
    
    var chol_points = 0;
    var smoking_points = 0;
    
    if ( age >= 20 && age <= 39 )
    {
        if ( smoking == 1 )
            smoking_points = (female == 1) ? 9 : 8;
        if ( chol <= 4.14 )
            chol_points = 0;
        else if ( chol <= 5.19 )
            chol_points = (female == 1) ? 4 : 4;
        else if ( chol <= 6.19 )
            chol_points = (female == 1) ? 8 : 7;
        else if ( chol <= 7.2 )
            chol_points = (female == 1) ? 11 : 9;
        else
            chol_points = (female == 1) ? 13 : 11;
    }
    else if ( age <= 49 )
    {
        if ( smoking == 1 )
            smoking_points = (female == 1) ? 7 : 5;
        
        if ( chol <= 4.14 )
            chol_points = 0;
        else if ( chol <= 5.19 )
            chol_points = (female == 1) ? 3 : 3;
        else if ( chol <= 6.19 )
            chol_points = (female == 1) ? 6 : 5;
        else if ( chol <= 7.2 )
            chol_points = (female == 1) ? 8 : 6;
        else
            chol_points = (female == 1) ? 10 : 8;
    }
    else if ( age <= 59 )
    {
        if ( smoking == 1 )
            smoking_points = (female == 1) ? 4 : 3;
        
        if ( chol <= 4.14 )
            chol_points = 0;
        else if ( chol <= 5.19 )
            chol_points = (female == 1) ? 2 : 2;
        else if ( chol <= 6.19 )
            chol_points = (female == 1) ? 4 : 3;
        else if ( chol <= 7.2 )
            chol_points = (female == 1) ? 5 : 4;
        else
            chol_points = (female == 1) ? 7 : 5;
    }
    else if ( age <= 69 )
    {
        if ( smoking == 1 )
            smoking_points = (female == 1) ? 2 : 1;
        
        if ( chol <= 4.14 )
            chol_points = 0;
        else if ( chol <= 5.19 )
            chol_points = (female == 1) ? 1 : 1;
        else if ( chol <= 6.19 )
            chol_points = (female == 1) ? 2 : 1;
        else if ( chol <= 7.2 )
            chol_points = (female == 1) ? 3 : 2;
        else
            chol_points = (female == 1) ? 4 : 3;
    }
    else if ( age <= 79 )
    {
        if ( smoking == 1 )
            smoking_points = (female == 1) ? 1 : 1;
        
        if ( chol <= 4.14 )
            chol_points = 0;
        else if ( chol <= 5.19 )
            chol_points = (female == 1) ? 1 : 0;
        else if ( chol <= 6.19 )
            chol_points = (female == 1) ? 1 : 0;
        else if ( chol <= 7.2 )
            chol_points = (female == 1) ? 2 : 1;
        else
            chol_points = (female == 1) ? 2 : 1;
    }
    
    var hdl_points = 0;
    
    if ( hdl_chol >= 1.55 )
        hdl_points = -1;
    else if ( hdl_chol > 1.3 )
        hdl_points = 0;
    else if ( hdl_chol > 1.04 )
        hdl_points = 1;
    else
        hdl_points = 2;
    
    var systolic_points = 0;
    
    if ( treated_bp == 0 )
    {
        //untreated bp
        if ( systolic < 120 )
            systolic_points = (female == 1) ? 0 : 0;
        else if ( systolic < 129 ) 
            systolic_points = (female == 1) ? 1 : 0;
        else if ( systolic < 139 ) 
            systolic_points = (female == 1) ? 2 : 1;
        else if ( systolic < 159 ) 
            systolic_points = (female == 1) ? 3 : 1;
        else 
            systolic_points = (female == 1) ? 4 : 2;
    }
    else
    {
        //treated bp        
        if ( systolic < 120 )
            systolic_points = (female == 1) ? 0 : 0;
        else if ( systolic < 129 ) 
            systolic_points = (female == 1) ? 3 : 1;
        else if ( systolic < 139 ) 
            systolic_points = (female == 1) ? 4 : 2;
        else if ( systolic < 159 ) 
            systolic_points = (female == 1) ? 5 : 2;
        else 
            systolic_points = (female == 1) ? 6 : 3;
    }
    
    var total_points = age_points + chol_points + smoking_points + hdl_points + systolic_points;
    
    if ( female == 0 )
    {
        //male
        if ( total_points <= 4 )
            return 0.01;
        else if ( total_points <= 6 )
            return 0.02;
        else if ( total_points <= 7 )
            return 0.03;
        else if ( total_points <= 8 )
            return 0.04;
        else if ( total_points <= 9 )
            return 0.05;
        else if ( total_points <= 10 )
            return 0.06;
        else if ( total_points <= 11 )
            return 0.08;
        else if ( total_points <= 12 )
            return 0.10;
        else if ( total_points <= 13 )
            return 0.12;
        else if ( total_points <= 14 )
            return 0.16;
        else if ( total_points <= 15 )
            return 0.20;
        else if ( total_points <= 16 )
            return 0.25;
        else
            return 0.30;
    }
    else
    {
        //female
        if ( total_points <= 12 )
            return 0.01;
        else if ( total_points <= 14 )
            return 0.02;
        else if ( total_points <= 15 )
            return 0.03;
        else if ( total_points <= 16 )
            return 0.04;
        else if ( total_points <= 17 )
            return 0.05;
        else if ( total_points <= 18 )
            return 0.06;
        else if ( total_points <= 19 )
            return 0.08;
        else if ( total_points <= 20 )
            return 0.11;
        else if ( total_points <= 21 )
            return 0.14;
        else if ( total_points <= 22 )
            return 0.17;
        else if ( total_points <= 23 )
            return 0.22;
        else if ( total_points <= 24 )
            return 0.27;
        else
            return 0.30;
    }
}

function decisionSupport(){     
    if (document.getElementById('counter').value.length<1) {
        //The searchbox picks up user input and must be pretty      
            document.getElementById('counter').value='1';
        var history2 = document.getElementById('history2').value;
        var history2Split = history2.split("]]-----\n");
        var History2 = history2Split.pop().toUpperCase();
            document.getElementById('searchbox').value = History2;
        var meds = document.getElementById('Meds').value.toString();
        var FreeText = /\(.*\)/g;
        var string = meds;
            document.getElementById('searchboxRx').value = string.replace(FreeText,"");
            document.getElementById('history2').value= history2Split.join("\n");
    } 
    //dynamically resize based on number of lines
    document.getElementById('searchbox').style.height= 19+getLines('searchbox')*10;
    document.getElementById('searchboxRx').style.height= 19+getLines('searchboxRx')*10;
    
    //The searchbox has only the first bullet of the history and possibly user input
    //all takes all the history items and anything in the disease registry
    var all=document.getElementById('searchbox').value + document.getElementById('dxlist').value;
     allRx = document.getElementById('searchboxRx').value ;
    function SystolicPressure(){
        var ref=document.getElementById('BP').value.toString(); 
        var mySplitResult = ref.split('/');
        var x= mySplitResult[0];
        return x;
    }
    
            
    function HasDM(){  
        var FreeText = /Diabetes Mellitus|IDDM|\sDM\s|T2DM|T1DM|type 2 DM|type2 DM|type1 DM|NIDDM|type 1 DM|T2DM|T2 DM|\sDM2\s/i;
        var match = all.search(FreeText);
        var FreeText = /METFORMIN|INSULIN|GLYBURIDE|GLICLAZIDE/i;
        var match2 = allRx.search(FreeText);
        var theA1C = parseFloat(document.getElementById('A1Cvalue').value);
        if( (match != -1)||(match2 != -1) ||(theA1C >6.5)){ 
                $('#DMC').css('color', 'red');
                $('#DMtitle').css('color', 'red');
            return true;
        }
        return false;
    }

    function HasCAD(){
        var FreeText = /ischemi|IHD|\sCAD\s|\sMI\s|stent|coronary|CABG/i;
        var match = all.search(FreeText);
        var FreeText = /NITROGLYCERIN|CLOPIDOGREL/i;
        var match2 = allRx.search(FreeText);
        if( (match != -1)||(match2 != -1) ){ 
            return true;
        }
        return false;
    }

    function HasCHF(){ 
        var FreeText = /CHF|Congestive cardiac|Congestive heart failure|heart failure|LVF|RVF|Systolic dysfunction|Diastolic dysfunction|pulmonary edema|pulmonary oedema|\sHF\s/i;
        var match = all.search(FreeText);
        if(match != -1){ 
                $('#CHFC').css('color', 'red');
                $('#CHFtitle').css('color', 'red');
            return true;
        }
        return false;
    }

    function HasHTN(){ 
        var FreeText = /HBP|Hypertension|Elevated BP|\sBP\s|\sHTN\s/i;
        var match = all.search(FreeText);
        if(match != -1){ 
                $('#HBPC').css('color', 'red');
                $('#HBPtitle').css('color', 'red');
            return true;
        }
        return false;
    }

    function HasCKD(){ 
        var FreeText = /CKD|Chronic kidney disease|Renal failure|renal insufficiency|\sCRF\s/i;
        var match = all.search(FreeText);
        var estGFR = parseFloat(document.getElementById('eGFRvalue').value); 
        if( (match != -1)||((estGFR < 45)&&(estGFR > 0)) ){
                $('#CKDC').css('color', 'red');
                $('#CKDtitle').css('color', 'red');     
            return true;
        }
        return false;
    }

    function OnStatin(){
        var FreeText = /STATIN/i;
        var match2 = allRx.search(FreeText);
        if(match2 != -1){       
            return true;
        }
        return false;
    }
    
    function OnAAPsy(){
        var FreeText = /AntipsychoticAtypical|risperidone|quetiapine|olanzapine|aripiprazole|clozapine/i;
        var match2 = allRx.search(FreeText);
        if(match2 != -1){ 
            return true;
        }
        return false;
    }
    
    function OnAccutane(){
        var FreeText = /ISOTRETINOIN/i;
        var match2 = allRx.search(FreeText);
        if(match2 != -1){ 
            return true;
        }
        return false;
    }

    

// LIPID assessment
// NICE 2010 recommends that all adults 40-74 should have an estimate of CVD risk and if elevated to get a cholesterol.
// If the risk remains above 20% after lifestyle modifications Simvastatin 40mg should be considered.  
// The logic we use here is that adults 35-75 without diabetes, CKD or IHD can be risk assessed by Framingham.  
// 75 is the upper age cut off as some at that age are fit and may benefit and others are infirm and are unlikely to gain
// If at low risk they can have the lipids done q 5 years.  The pretest risk threshold for annual testing is set at 15%.
// This tool just simplifies population based screening, but it is not a substitute for critical thinking
// eg. Framingham does not assess the added risk of low SES 
// nor 
// a family history of premature CHD 
// (a first degree male relative with CHD under age 50 or female relative under age 60 can double the risk).    
 
 
    var age              = parseFloat(document.getElementById("PatientAge").value); 
    var sex              = (document.getElementById("PatientGender").value=='M')?0:1; //1 if female, 0 if male 
    //var smoking        = ((document.getElementById('smoker').value == 'yes')||(document.getElementById('smoker').value == 'Yes')||(document.getElementById('dailySmokes').value >0)||(document.getElementById('PacksPerDay').value >0))?1:0; //1 if smoker (or quit within last year), 0 otherwise            
    var systolic         = SystolicPressure();  
    var treated_bp       = (HasHTN())?1:0; 
    var total_chol       = parseFloat(document.getElementById("TCHLvalue").value);
    var hdl_chol         = parseFloat(document.getElementById("HDLvalue").value); 
    var predict_length   = 10; 
    var lipid_ratio      = total_chol / hdl_chol;
    var risk             = 0;
    var threshold       = 10; //NICE suggested a threshold of 20%, now down to 10%
    var Diabetic         = (HasDM())?1:0; 
    var IHD              = (HasCAD())?1:0; 
    var CKD              = (HasCKD())?1:0; 
    var CHF              = (HasCHF())?1:0;
    var cssString        = 'text-align:left; color:red; background:white;'; 
    var cssString2       = 'text-align:left; color:green; background:white;';
    var theA1C           = parseFloat(document.getElementById('A1Cvalue').value);
    var estGFR           = parseFloat(document.getElementById("eGFRvalue").value); 
    Statin               = (OnStatin())?1:0;
    FramGender           =(document.getElementById("PatientGender").value=='M')?"Male":"Female";
    FramSmoking          = ((document.getElementById('smoker').value == 'yes')||(document.getElementById('smoker').value == 'Yes')||(document.getElementById('dailySmokes').value >0)||(document.getElementById('PacksPerDay').value >0))?"Yes":"No";
    FramTreatedBP        = (HasHTN())?"Yes":"No";
    FramDiabetic         = (HasDM())?"Yes":"No";
    FramIHD              = (HasCAD())?"Yes":"No";
    FramCKD              = (HasCKD())?"Yes":"No";
    FramSystolic         = systolic;
    FramTC               = total_chol;
    FramHDL              = hdl_chol;
    AAPsychotic          = (OnAAPsy())?1:0;
    Accutane             = (OnAccutane())?1:0;
    
    if (($("#SmokingStatus").is(':checked') ==true)) {
      var smoking = 1;
      var FramSmoking = 'Yes';
      if($("#smoker").val() != FramSmoking){
       $('#ReturnSmokingStatus').val(FramSmoking);
      } 
// removed to stop automatic push of NO to SKST if smoking box is NOT checked
//    if($("#smoker").val() == FramSmoking){
//       $('#ReturnSmokingStatus').val('');
//      } 
     } 

    if (($("#SmokingStatus").is(':checked') ==false)) {
      var smoking = 0;
      var FramSmoking = 'No';
      } 
    
     if (($("#FamilyHistory").is(':checked') ==true)) {
      var familyHistoryCVD = 'Yes';
      } 
     if (($("#FamilyHistory").is(':checked') ==false)) {
      var familyHistoryCVD = 'No';
      } 

//     if($("#FHCVD").val() != familyHistoryCVD){
//       $('#ReturnFHCVD').val(familyHistoryCVD);
//      } 
//     if($("#FHCVD").val() == familyHistoryCVD){
//       $('#ReturnFHCVD').val('');
//      } 
      
    if (age >= 20) {
        // no need to screen young adults at no identified risk: US Preventative Task Force Grade A
        if ( (lipid_ratio)&&(systolic) ) {
            risk = Math.round(GetFraminghamCHDRiskPoints(age, sex, smoking, systolic, treated_bp, total_chol, hdl_chol)*100);
            if ($("#FamilyHistory").is(':checked') ==true) {
                risk = (Math.round(GetFraminghamCHDRiskPoints(age, sex, smoking, systolic, treated_bp, total_chol, hdl_chol)*100)*1.5);
                } else {
                risk = Math.round(GetFraminghamCHDRiskPoints(age, sex, smoking, systolic, treated_bp, total_chol, hdl_chol)*100);
                   }
            //risk = Math.round(Framingham1991(age, sex, smoking, systolic, lipid_ratio, predict_length)*100);
            var lipidDate = document.getElementById("TCHLdate").value;
            if ( (lipidDate != "")&&(lipidDate != document.getElementById("m$FRAM#dateObserved").value)&&(!(Diabetic))&&(!(IHD)) ) {
                document.getElementById("m$FRAM#dateObserved").value = lipidDate ;
                document.getElementById("m$FRAM#value").value= risk ;
                //add('subject', risk+"% Framingham risk");
            
            }
        } else {
            //stratify by risk calculated from existing data assuming average to poor bp and lipids
            if (!(systolic)) { systolic=150; FramSystolic = "ESTIMATED 150";}                       
            //risk = Math.round(GetFraminghamCHDRiskPoints(age, sex, smoking, systolic, treated_bp, '6', '1')*100);
            risk = Math.round(Framingham1991(age, sex, smoking, systolic, '6', predict_length)*100);
            if ($("#FamilyHistory").is(':checked') ==true) {
                risk = (Math.round(Framingham1991(age, sex, smoking, systolic, '6', predict_length)*100)*1.5);
                } else {
                risk = Math.round(Framingham1991(age, sex, smoking, systolic, '6', predict_length)*100);
                   }
            FramTC = "ESTIMATED 6";
            FramHDL = "ESTIMATED 1";            
        }
        
        if (Diabetic) {
            // UKPDS might be better but some argue that it underestimates risk
            risk= 30;  //this is above the threshold
        }

        if (IHD) {
            // the subject should be added only based on bloodwork being ordered, but no panel for this
            //add('subject','IHD ');
            risk= 30;  //this is above the threshold
        }

        if (CKD) {
            risk= 30;  //this is above the threshold
        }
    }

    //Risk score not done below 20yrs
    if ( (age>=0)&&(age<20)){
               AddIfMissingTitle('LIPID1',"Patient is "+age+" yrs old. This CVD risk calculator is not valid below age 20yrs. \n" );
               AddIfMissingTitle('LIPID1',"No need to screen young adults at no identified risk: US Preventative Task Force Grade A.\n" );
               $('#lipidHeader').css('color', '#008000');
        }
        
    //Risk score range set for 20-74yrs 
    if ((age>=75)||(age<20)) {
    AddIfMissingTitle('Framtitle',"This patient is "+age+"\nThe risk calculator is only useful between ages 20 and 75yrs." );
    $("#Framtitle").css('color', 'black');
    }   
    if ((age>=20)&&(age<75)) {
    // populates Fram Score in side bar and changes color green blue red for low mod high risk ranges
    $("#Framrisk").val("~"+risk+"%");
    if (risk <10){
    $("#Framrisk").css('color', 'green');
    $("#Framtitle").css('color', 'green');
    }
    if ((risk >= 10)&&(risk < 20)){
    $("#Framrisk").css('color', 'blue');
    $("#Framtitle").css('color', 'blue');
    }
    if (risk >= 20){
    $("#Framrisk").css('color', 'red');
    $("#Framtitle").css('color', 'red');
    }
    // Hover over Fram Score shows what was used to make the score
    StartAddIfMissingTitle('Framtitle',"CLICK to go to CVD Risk Calculator v2\n" );
    AddIfMissingTitle('Framtitle',"Age:"+age+"\n" );
    AddIfMissingTitle('Framtitle',"Sex:"+FramGender+"\n" );
    AddIfMissingTitle('Framtitle',"Smoker:"+FramSmoking+"\n" );
    AddIfMissingTitle('Framtitle',"Systolic pressure:"+FramSystolic+"\n" );
    AddIfMissingTitle('Framtitle',"BP treated:"+FramTreatedBP+"\n" );
    AddIfMissingTitle('Framtitle',"Total cholesterol:"+FramTC+"\n" );
    AddIfMissingTitle('Framtitle',"HDL cholesterol:"+FramHDL+"\n" );
    AddIfMissingTitle('Framtitle',"Diabetes:"+FramDiabetic+"\n" );
    AddIfMissingTitle('Framtitle',"IHD:"+FramIHD+"\n" );
    AddIfMissingTitle('Framtitle',"CKD:"+FramCKD+"\n" );
    
    // Hover over smoker and family history
    AddIfMissingTitle('SmokingStatus',"Current smoker OR smoker within last 5yrs." );
    AddIfMissingTitle('FamilyHistory',"First degree family history of early CHD.\nMale < 55yrs or female < 65yrs.\nIncreases risk by 1.5." );
    
    if (risk<threshold){
        //for patients at low risk a single cholesterol is recommended for males >40 and females >50.This form allows for a cholesterol done within 5yrs of that age.
        StartAddIfMissingTitle('LIPID1',"At low ~"+risk+"% 10yr cardiac risk. " );
        $('#lipidHeader').css('color', '#008000');
        if ((sex==1)&&(age>=50)&&(getLabAge('TCHLdate') <= ((age-49)*12))) {
        AddIfMissingTitle('LIPID1',"\nThis female patient has had a lipid screening profile at "+(age-(Math.round((getLabAge('TCHLdate'))/12)))+" yrs of age fulfills the recommendations of a single lipid profile screen around 50yrs.\nThere is no need for further lipid screening unless her medical condition changes or if you are considering low risk primary prevention with a statin drug\nLow risk primary prevention with a statin is not generally recommended." );
            }
        if ((sex==0)&&(age>=40)&&(getLabAge('TCHLdate') <= ((age-39)*12))) {
        AddIfMissingTitle('LIPID1',"\nThis male patient has had a lipid screening profile at "+(age-(Math.round((getLabAge('TCHLdate'))/12)))+" yrs of age which fulfills the recommendations of a single lipid profile screen around 40yrs.\nThere is no need for further lipid screening unless his medical condition changes or if you are considering low risk primary prevention with a statin drug\nLow risk primary prevention with a statin is not generally recommended." );
            }
        
       if ( ((sex==1)&&(age>=50))||((sex==0)&&(age>=40)) ){     
           if (((getLabAge('TCHLdate')> ((age-39)*12))&&(sex==0))||((getLabAge('TCHLdate')> ((age-49)*12))&&(sex==1))){
                AddIfMissingTitle('LIPID1',"\nPatient is "+age+" yrs old.\nFor low risk males >40yrs and females >50yrs a single screening lipid profile is recommended.\nThis does not need to be repeated unless the patients risks change." );
                $('#lipidHeader').css('color', '#ff0000');
                $("#Lipid_full").addClass('yellow');
            }
        }
        
        if ( ((sex==1)&&(age<50))||((sex==0)&&(age<40)) ){  
            if (getLabAge('TCHLdate')!=1200){
                AddIfMissingTitle('LIPID1',"\nA lipid profile was done at "+(age-(Math.round((getLabAge('TCHLdate'))/12)))+" yrs of age.\nPatient is "+age+"yrs old.\nFor low risk patients a single screening lipid profile is recommended for males at age 40yrs and females at age 50yrs." );
            }
            if (getLabAge('TCHLdate')==1200){
                AddIfMissingTitle('LIPID1',"\nPatient is "+age+"yrs old.\nFor low risk patients a single screening lipid profile is recommended for males at age 40yrs and females at age 50yrs." );
            }
        }       
    } 
    if ((risk >= threshold)&&(Statin==0)&&(age>=20)&&(age<40)&&(sex==0)) {         
            //More aggressive and frequent determinations are indicated for those at higher risk. Initially every 5yrs. No lipid monitoring if on statin. 
            StartAddIfMissingTitle('LIPID1',"At ~"+risk+"% 10yr cardiac risk. " );
            AddIfMissingTitle('LIPID1',"\nPatient is "+age+" yrs old.\nFor males less than 40yrs at higher CVD risk that are not considering a statin for primary prevention at this time, it would be reasonable to do lipid profiles every 5yrs. " );
            if(getLabAge('TCHLdate')>60){
                //red it
                AddIfMissingTitle('LIPID1',"\nThere is no charted cholesterol in the last 5 years so consider repeating a lipid profile. " );
                $('#lipidHeader').css('color', '#ff0000');
                $("#Lipid_full").addClass('yellow');
            } else {
                //green it
                AddIfMissingTitle('LIPID1',"Recent cholesterol done "+Math.round(getLabAge('TCHLdate')/12)+ " years ago. " );
                $('#lipidHeader').css('color', '#008000');
            }
        }
    if ((risk >= threshold)&&(Statin==0)&&(age>=20)&&(age<50)&&(sex==1)) {         
            //More aggressive and frequent determinations are indicated for those at higher risk. Initially every 5yrs.No lipid monitoring if on statin. 
            StartAddIfMissingTitle('LIPID1',"At ~"+risk+"% 10yr cardiac risk. " );
            AddIfMissingTitle('LIPID1',"\nPatient is "+age+" yrs old.\nFor females less than 50yrs at higher CVD risk that are not considering a statin for primary prevention at this time, it would be reasonable to do lipid profiles every 5yrs. " );
            if(getLabAge('TCHLdate')>60){
                //red it
                AddIfMissingTitle('LIPID1',"\nThere is no charted cholesterol in the last 5 years so consider repeating a lipid profile. " );
                $('#lipidHeader').css('color', '#ff0000');
                $("#Lipid_full").addClass('yellow');
            } else {
                //green it
                AddIfMissingTitle('LIPID1',"Recent cholesterol done "+Math.round(getLabAge('TCHLdate')/12)+ " years ago. " );
                $('#lipidHeader').css('color', '#008000');
            }
        }
    if ((risk >= threshold)&&(Statin==0)&&(age>=50)&&(sex==1)){            
            //Increase monitoring to Q2yrs for high risk males >40 and females >50. No lipid monitoring if on statin.
            StartAddIfMissingTitle('LIPID1',"At ~"+risk+"% 10yr cardiac risk. " );
            AddIfMissingTitle('LIPID1',"\nPatient is "+age+" yrs old.\nFor females older than 50yrs at higher CVD risk that are not considering a statin for primary prevention at this time, it would be reasonable to do lipid profiles every 2yrs. " );
            if(getLabAge('TCHLdate')>24){
                //red it
                AddIfMissingTitle('LIPID1',"No charted cholesterol in the last 2 years. " );
                $('#lipidHeader').css('color', '#ff0000');
                $("#Lipid_full").addClass('yellow');
            } else {
                //green it
                AddIfMissingTitle('LIPID1',"\nRecent cholesterol done "+Math.round(getLabAge('TCHLdate')/12)+ " years ago. " );
                $('#lipidHeader').css('color', '#008000');
            }
        }
        
    if ((risk >= threshold)&&(Statin==0)&&(age>=40)&&(sex==0)){            
            //Increase monitoring to Q2yrs for high risk males >40 and females >50. No lipid monitoring if on statin.
            StartAddIfMissingTitle('LIPID1',"At ~"+risk+"% 10yr cardiac risk. " );
            AddIfMissingTitle('LIPID1',"\nPatient is "+age+" yrs old.\nFor males older than 40yrs at higher CVD risk that are not considering a statin for primary prevention at this time, it would be reasonable to do lipid profiles every 2yrs. " );
            if(getLabAge('TCHLdate')>24){
                //red it
                AddIfMissingTitle('LIPID1',"No charted cholesterol in the last 2 years. " );
                $('#lipidHeader').css('color', '#ff0000');
                $("#Lipid_full").addClass('yellow');
            } else {
                //green it
                AddIfMissingTitle('LIPID1',"\nRecent cholesterol done "+Math.round(getLabAge('TCHLdate')/12)+ " years ago. " );
                $('#lipidHeader').css('color', '#008000');
            }
        }
    
    if ((Statin==0)&&(age>=20)&&(AAPsychotic==1)) {         
            //Do lipid profiles biannually for AApsychotics.No lipid monitoring reasonable if on statin. 
            StartAddIfMissingTitle('LIPID1',"At ~"+risk+"% 10yr cardiac risk. " );
            AddIfMissingTitle('LIPID1',"\nPatient is "+age+" yrs old and is on an atypical antipsychotic. Biannual lipid profiles are reasonable. " );
            if(getLabAge('TCHLdate')>23){
                //red it
                AddIfMissingTitle('LIPID1',"\nThere is no charted cholesterol in the last 2 years so consider repeating a lipid profile. " );
                $('#lipidHeader').css('color', '#ff0000');
                $("#Lipid_full").addClass('yellow');
            } else {
                //green it
                AddIfMissingTitle('LIPID1',"\nRecent cholesterol done "+getLabAge('TCHLdate')+ " months ago. " );
                $('#lipidHeader').css('color', '#008000');
            }
        }
    if ((Statin==0)&&(age>=20)&&(CKD==1)) {         
            //Do lipid profiles biannually for CKD.No lipid monitoring reasonable if on statin. 
            StartAddIfMissingTitle('LIPID1',"At ~"+risk+"% 10yr cardiac risk. " );
            AddIfMissingTitle('LIPID1',"\nPatient is "+age+" yrs old and has CKD. Biannual lipid profiles are reasonable. " );
            if(getLabAge('TCHLdate')>23){
                //red it
                AddIfMissingTitle('LIPID1',"\nThere is no charted cholesterol in the last 2 years so consider repeating a lipid profile. " );
                $('#lipidHeader').css('color', '#ff0000');
                $("#Lipid_full").addClass('yellow');
            } else {
                //green it
                AddIfMissingTitle('LIPID1',"\nRecent cholesterol done "+getLabAge('TCHLdate')+ " months ago. " );
                $('#lipidHeader').css('color', '#008000');
            }
        }
    if ((Statin==0)&&(age>=20)&&(Diabetic==1)) {            
            //Do lipid profiles annually for diabetics.No lipid monitoring reasonable if on statin. 
            StartAddIfMissingTitle('LIPID1',"At ~"+risk+"% 10yr cardiac risk. " );
            AddIfMissingTitle('LIPID1',"\nPatient is "+age+" yrs old and has diabetes and is not on a statin. Annual lipid profiles are recommended. " );
            if(getLabAge('TCHLdate')>11){
                //red it
                AddIfMissingTitle('LIPID1',"\nThere is no charted cholesterol in the last year so consider repeating a lipid profile. " );
                $('#lipidHeader').css('color', '#ff0000');
                $("#Lipid_full").addClass('yellow');
            } else {
                //green it
                AddIfMissingTitle('LIPID1',"\nRecent cholesterol done "+getLabAge('TCHLdate')+ " months ago. " );
                $('#lipidHeader').css('color', '#008000');
            }
        }
    if ((Statin==0)&&(age>=20)&&(Accutane==1)) {            
            //Do lipid profiles monthly on accutane.No lipid monitoring reasonable if on statin. 
            StartAddIfMissingTitle('LIPID1',"At ~"+risk+"% 10yr cardiac risk. " );
            AddIfMissingTitle('LIPID1',"\nPatient is "+age+" yrs old and is on accutane. Monthly lipid profiles are recommended. " );
            if(getLabAge('TCHLdate')>1){
                //red it
                AddIfMissingTitle('LIPID1',"\nThere is no charted cholesterol in the last month so consider repeating a lipid profile. " );
                $('#lipidHeader').css('color', '#ff0000');
                $("#Lipid_full").addClass('yellow');
            } else {
                //green it
                AddIfMissingTitle('LIPID1',"\nRecent cholesterol done "+getLabAge('TCHLdate')+ " months ago. " );
                $('#lipidHeader').css('color', '#008000');
            }
        }
        
    if ((risk >= threshold)&&(Statin==1)) {            
            //No lipid monitoring if on statin.
            StartAddIfMissingTitle('LIPID1',"At ~"+risk+"% 10yr cardiac risk.\n " );
            AddIfMissingTitle('LIPID1',"Patient is on a statin drug.\n There is a move towards titrating the statin dose and ignoring the LDL level, so reasonable to not repeat lipid profile " );
                $('#lipidHeader').css('color', '#008000');
            }       
    }
    
    if (age>=75){
            StartAddIfMissingTitle('LIPID1',"Patient is "+age+" yrs old. " );
            AddIfMissingTitle('LIPID1',"Risk is elevated in the elderly, but there is little evidence for statins in PRIMARY PREVENTION over age 75yrs. " );
            AddIfMissingTitle('LIPID1',"\nTreatment may be beneficial (ARR 0.5-2% SAGE PROSPER) for those older than 75yrs with established disease or with risk factors such as smoking or hypertension. " );
            AddIfMissingTitle('SmokingStatus',"Current smoker OR smoker within last 5yrs." );
            AddIfMissingTitle('FamilyHistory',"First degree family history of early CHD.\nMale < 55yrs or female < 65yrs.\nIncreases risk by 1.5." );
    }       

    //Costs 
    $("#HematologyProfile").attr('title', 'Cost: $10,96-$28,95');
    $("#PTINR").attr('title', 'Cost: $12,07');
    $("#Ferritin").attr('title', 'Cost: $10,12');
    $("#A1c").attr('title', 'Cost: $12,69');
    $("#ACR").attr('title', 'Cost: $11,41');
    $("#MonitorThyroidRx").attr('title', 'Cost: $9,90');
    $("#TSH").attr('title', 'Cost: $9,90 + $12,12 = $22,02');
    $("#Sodium").attr('title', 'Cost: $1.38');
    $("#Potassium").attr('title', 'Cost: $1.39');
    $("#CreatinineGFR").attr('title', 'Cost: $1.52');
    $("#Lipid_full").attr('title', 'Cost: $21,31');
    $("#Lipid_FU").attr('title', 'Cost: $14,44');
    $("#Lipid_ApoB").attr('title', 'Cost: $16,60');
    // $("#LipidProfileNon-MSP").attr('title', 'Cost: $21,31');
    $("#SuspectHyperthyroidism").attr('title', 'Cost: $9,90 + $12,12 + 12,12 = $34,14');
    $("#GlucoseFasting").attr('title', 'Cost: $1.46');
    $("#GlucoseRandom").attr('title', 'Cost: $1.46');
    $("#GTTGDMScreen").attr('title', 'Cost: $10,03');
    $("#GTTGDMConfirmation").attr('title', 'Cost: $15,84');
    $("#Albumin").attr('title', 'Cost: $1,55');
    $("#AlkPhos").attr('title', 'Cost: $1,57');
    $("#ALT").attr('title', 'Cost: $1,47');
    $("#Bilirubin").attr('title', 'Cost: $1,61');
    $("#GGT").attr('title', 'Cost: $1,66');
    $("#TProtein").attr('title', 'Cost: $1,60');
    $("#Calcium").attr('title', 'Cost: $1.55');
    $("#CreatineKinase").attr('title', 'Cost: $1,88');
    $("#PSAbillMSP_Yes").attr('title', 'Cost: $14,35');
    $("#PSAbillMSP_No").attr('title', 'Cost: $14,35');
    $("#bHCG").attr('title', 'Cost: $16,30');
    $("#PregnancyTest").attr('title', 'Cost: $15,30');
    $("#UrineCulture").attr('title', 'Cost: $19.57 + $9.55/org + $11.61/Ab Sus');
    $("#UrineMicroscopicOnly").attr('title', 'Cost: $7.17');
    $("#UrineMacroscopicOnly").attr('title', 'Cost: $7.42');
    $("#UrineMacroscopicMicroscopicIfDipstickPositive").attr('title', 'Cost: $14.59');
    $("#UrineMacroscopicCultureIfPyuriaOrNitrate").attr('title', 'Cost: $26.99 + $9.55/org + $11.61/Ab Sus');
    $("#ECG").attr('title', 'Cost: $32.47');
    $("#Holter").attr('title', 'Cost: $89.19');
    $("#FIT_CSP").attr('title', 'Cost: $19.60');
    $("#FIT_Other").attr('title', 'Cost: $19.60');
    $("#B12").attr('title', 'Cost: $14.38');
    $("#CRPC").attr('title', 'Cost: $10.31');
    $("#ESRC").attr('title', 'Cost: $10.61');
    $("#VaginoAnoRectalGBS").attr('title', 'Cost: $15.40');
    $("#ChlamydiaGC").attr('title', 'Cost: $29.94');
    $("#CDToxin").attr('title', 'Cost: $16.64');
    $("#StoolCS").attr('title', 'Cost: $16.90 + $14.42/org');
    $("#StoolOP").attr('title', 'Cost: $46.93');
    $("#StoolOPHighRisk").attr('title', 'Cost: $93.86');
    $("#DermatophyteCulture").attr('title', 'Cost: $21.41');
    $("#FungusKOHPrep").attr('title', 'Cost: $13.76');
    $("#HBsAg").attr('title', 'Cost: $10.40');
    $("#URICC").attr('title', 'Cost: $1.70');
    $("#DIGC").attr('title', 'Cost: $18.97');
    $("#DILC").attr('title', 'Cost: $17.13');
    $("#LITHC").attr('title', 'Cost: $14.94');
    $("#CEAC").attr('title', 'Cost: $20.40');
    $("#AFPC").attr('title', 'Cost: $24.79');
    $("#ANAC").attr('title', 'Cost: $23.82 + $74.64/Ab');
    $("#RFC").attr('title', 'Cost: $8.41');
    $("#ASTC").attr('title', 'Cost: $1.73');
    $("#AcuteViralHepatitis").attr('title', 'Cost: $36.12');
    $("#ChronicViralHepatitis").attr('title', 'Cost: $47.26');
    $("#HepatitisAImmuneStatus").attr('title', 'Cost: $18.42');
    $("#HepatitisBImmuneStatus").attr('title', 'Cost: $11.08');
    $("#HIVNominal").attr('title', 'Cost: ?$10.00');
    $("#HIVNonNominal").attr('title', 'Cost: ?$10.00');
    $("#Throat").attr('title', 'Cost: $18.75 - 27.73');
    $("#SuperficialWound").attr('title', 'Cost: $52.79 - 62.34');
    $("#DeepWound").attr('title', 'Cost: $52.79 - 62.34');
    $("#VaginitisInitial").attr('title', 'Cost: $38.92 - 48.80');
    $("#VaginitisChronic").attr('title', 'Cost: $24.35');
    $("#Trichomonas").attr('title', 'Cost: $11.63 - 18.75');
    $("#GCOnly").attr('title', 'Cost: $28.85 - 29.94');
    $("#YeastCulture").attr('title', 'Cost: $23.52');
    $("#FungusCulture").attr('title', 'Cost: $13.76 - 47.67');
    
    setInterval(function calculateCost() {
          $('#Costs').val(0);
          StartAddIfMissingTitle('Costs',"" );
          
          var othertests = $('#AdditionalTestInstructions').val();
          var OtherTests = othertests.toUpperCase(); 
          var match = OtherTests.search("AST|PHOSPHATE|PO4|URIC|LDH|LACTATE DEHYDROGENASE");

            if ( (match != -1)||(($('#Sodium').val()=='X')||($('#Potassium').val()=='X')||($('#CreatinineGFR').val()=='X')||($('#Albumin').val()=='X')||($('#AlkPhos').val()=='X')||($('#ALT').val()=='X')||($('#Bilirubin').val()=='X')||($('#GGT').val()=='X')||($('#TProtein').val()=='X')||($('#Calcium').val()=='X')||($('#CreatineKinase').val()=='X')||($('#GlucoseRandom').val()=='X')||($('#GlucoseFasting').val()=='X') ) ){
            newcost = Math.round(($('#Costs').val()*1)+15.62);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Base Chemistry Fee: $15.62\n" );
            }
          
            if ($('#Sodium').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+1.39);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Na: $1.39\n" );
            }
            if ($('#Potassium').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+1.38);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"K: $1.38\n" );
            }
            if ($('#CreatinineGFR').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+1.52);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"eGFR: $1.52\n" );
            } 
            if ($('#Albumin').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+1.55);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Alb: $1.55\n" );
            }
            if ($('#AlkPhos').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+1.57);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"ALP: $1.57\n" );
            }
            if ($('#ALT').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+1.47);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"ALT: $1.47\n" );
            }
            if ($('#Bilirubin').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+1.61);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"BILI: $1.61\n" );
            }
            if ($('#GGT').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+1.66);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"GGT: $1.66\n" );
            }
            if ($('#TProtein').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+1.60);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"TProtein: $1.60\n" );
            }
            if ($('#Calcium').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+1.55);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Ca: $1.55\n" );
            }
            if ($('#CreatineKinase').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+1.88);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"CK: $1.88\n" );
            }
           if ($('#HematologyProfile').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+10.96);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"CBC: $10.96\n" );
            }
           if ($('#PTINR').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+12.07);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"INR: $12.07\n" );
            }
           if ($('#Ferritin').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+10.12);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Ferritin: $10.12\n" );
            }
           if ($('#GlucoseFasting').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+1.46);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"FBS: $1.46\n" );
            }
           if ($('#GlucoseRandom').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+1.46);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"RBS: $1.46\n" );
            }
           if ($('#GTTGDMScreen').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+10.03);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"50G GTT: $10.03\n" );
            }
           if ($('#GTTGDMConfirmation').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+15.84);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"75G GTT: $15.84\n" );
            }
           if ($('#A1c').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+12.69);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"A1C: $12.69\n" );
            }
           if ($('#ACR').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+11.41);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"ACR: $11.41\n" );
            }
           if ($('#Lipid_full').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+21.31);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"LipidProfile: $21.31\n" );
            }
           if ($('#Lipid_FU').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+14.44);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"LipidFU: $14.44\n" );
            }
           if ($('#Lipid_ApoB').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+16.60);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"ApoB: $16.60\n" );
            }
//            if ($('#LipidProfileNon-MSP').val()=='X') {
//            newcost = Math.round(($('#Costs').val()*1)+21.31);
//            $('#Costs').val(newcost);
//            AddIfMissingTitle('Costs',"LipidProfile: $21.31\n" );
//            }
           if ($('#MonitorThyroidRx').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+9.90);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"TSH: $9.90\n" );
            }
           if ($('#TSH').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+22.02);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"TSH/T4: $22.02\n" );
            }
           if ($('#SuspectHyperthyroidism').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+34.14);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"TSH/T4/T3: $34.14\n" );
            }
            if ($('#PSAbillMSP_Yes').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+14.35);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"PSA: $14.35\n" );
            }
            if ($('#PSAbillMSP_No').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+14.35);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"PSA: $14.35\n" );
            }
            if ($('#bHCG').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+16.30);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"SerumPregTest: $16.30\n" );
            }
            if ($('#PregnancyTest').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+15.30);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"UrinePregTest: $15.30\n" );
            }
            if (($('#FIT_CSP').val()=='X')||($('#FIT_Other').val()=='X')){
            newcost = Math.round(($('#Costs').val()*1)+19.60);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"FIT: $19.60\n" );
            }
            if ($('#ECG').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+32.47);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"ECG: $32.47\n" );
            }
            if ($('#Holter').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+89.19);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"ECG: $89.19\n" );
            }
            if ($('#UrineCulture').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+40.73);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"UrineCulture: $40.73 ($19.57 + $9.55/org + $11.61/Ab Sus)\n" );
            }
            if ($('#UrineMacroscopicMicroscopicIfDipstickPositive').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+14.59);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"UrineMacroMicro: $14.59\n" );
            }
            if ($('#UrineMacroscopicCultureIfPyuriaOrNitrate').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+48.15);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"UrineMacroCulture: $48.15 ($26.99 + $9.55/org + $11.61/Ab Sus)\n" );
            }
            if ($('#UrineMacroscopicOnly').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+7.42);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"UrineMacro: $7.42\n" );
            }
            if ($('#UrineMicroscopicOnly').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+7.17);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"UrineMicro: $7.17\n" );
            }
            if ($('#VaginoAnoRectalGBS').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+15.40);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"GBS: $15.40\n" );
            }
            if ($('#ChlamydiaGC').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+29.94);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"ChlGC: $29.94\n" );
            }
            if ($('#StoolCS').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+16.90);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Stool Culture: $16.90 + $14.42/org\n" );
            }
            if ($('#CDToxin').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+16.64);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"CDiff: $16.64\n" );
            }
            if ($('#StoolOP').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+46.93);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"StoolOP: $46.93\n" );
            }
            if ($('#StoolOPHighRisk').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+93.86);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"StoolOPX2: $93.86\n" );
            }
            if ($('#DermatophyteCulture').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+21.41);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Dermatophyte Culture: $21.41\n" );
            }
            if ($('#FungusKOHPrep').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+13.76);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Fungal KOH: $13.76\n" );
            }
            if ($('#HBsAg').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+10.40);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"HBsAg: $10.40\n" );
            }
            if ($('#AcuteViralHepatitis').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+36.12);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Acute hepatitis: $36.12\n" );
            }
            if ($('#ChronicViralHepatitis').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+47.20);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Chronic hepatitis: $47.20\n" );
            }
            if ($('#HepatitisAImmuneStatus').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+18.42);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"HepA status: $18.42\n" );
            }
            if ($('#HepatitisBImmuneStatus').val()=='X') {
            newcost = Math.round(($('#Costs').val()*1)+11.08);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"HepB Status: $11.08\n" );
            }
            if (($('#HIVNominal').val()=='X')||($('#HIVNonNominal').val()=='X')) {
            newcost = Math.round(($('#Costs').val()*1)+10.00);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"HIV: ?$10.00\n" );
            }
            if ($('#Throat').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+22.96);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Throat Swab: $22,96 ($18.18-27.23)\n" );
            }
            if ($('#SuperficialWound').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+57.57);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Sup Wound Cult: $57.57 ($52.79-62.34)\n" );
            }
            if ($('#DeepWound').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+57.57);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Deep Wound Cult: $57.57 ($52.79-62.34)\n" );
            }
            if ($('#VaginitisInitial').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+43.86);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"BV+Candida: $43.86 ($38.92-48.80)\n" );
            }
            if ($('#VaginitisChronic').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+24.35);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Vaginitis Chronic: $24.35 ($18.75-29.94)\n" );
            }
            if ($('#Trichomonas').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+15.19);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Trichomonas: $15.19 ($11.63-18.75)\n" );
            }
            if ($('#GCOnly').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+28.85);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"GC: $28.85\n" );
            }
            if ($('#YeastCulture').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+23.52);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Yeast: $23.52\n" );
            }
            if ($('#FungusCulture').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+30.72);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"Fungus: $30.72 ($13.76-47.67)\n" );
            }
            
            if ($('#B12').val()=='X'){
            newcost = Math.round(($('#Costs').val()*1)+14.38);
            $('#Costs').val(newcost);
            AddIfMissingTitle('Costs',"B12: $14.38\n" );
            }
                
            var match = OtherTests.search("ESR");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+10.61);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"ESR: $10.61\n" );
            }
            var match = OtherTests.search("CRP");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+10.31);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"CRP: $10.31\n" );
            }
            var match = OtherTests.search("TTG");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+24.18);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"TTG: $24.18\n" );
            }
            var match = OtherTests.search("HP BREATH");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+36.50);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"HPBreathTest: $36.50\n" );
            }
            var match = OtherTests.search("URIC");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+1.70);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Uric: $1.70\n" );
            }
            var match = OtherTests.search("DIG");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+18.97);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Digoxin: $18.97\n" );
            }
            var match = OtherTests.search("DILANT");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+17.13);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Dilantin: $17.13\n" );
            }
            var match = OtherTests.search("LITHIUM");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+14.94);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Lithium: $14.94\n" );
            }
            var match = OtherTests.search("MG|MAGNESIUM");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+6.79);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Mg: $6.79\n" );
            }
            var match = OtherTests.search("CA125");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+22.72);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"CA125: $22.72\n" );
            }
            var match = OtherTests.search("CA19-9");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+20.88);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"CA19-9: $20.88\n" );
            }
            var match = OtherTests.search("CA15-3");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+21.25);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"CA15-3: $21.25\n" );
            }
            var match = OtherTests.search("FSH");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+13.13);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"FSH: $13.13\n" );
            }
            var match = OtherTests.search("LH");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+12.41);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"LH: $12.41\n" );
            }
            var match = OtherTests.search("PROLACTIN");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+13.49);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Prolactin: $13.49\n" );
            }
            var match = OtherTests.search("BLOOD GROUP");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+16.09);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Blood Group: $16.09\n" );
            }
            var match = OtherTests.search("RH");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+10.38);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Rh: $10.38\n" );
            }
            var match = OtherTests.search("IPTH");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+17.52);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"iPTH: $17.52\n" );
            }
            var match = OtherTests.search("ENA");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+30.60);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"ENA: $30.60\n" );
            }
            var match = OtherTests.search("FACTOR 5");
            var match2 = OtherTests.search("FACTOR V");
            if ((match != -1)||(match2 != -1)) {
               newcost = Math.round(($('#Costs').val()*1)+52.04);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Factor 5 Leiden: $52.04\n" );
            }
            var match = OtherTests.search("PROTEIN C");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+51.33);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Protein C: $51.33\n" );
            }
            var match = OtherTests.search("PROTEIN S");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+38.31);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"PROTEIN S: $38.31\n" );
            }
            var match = OtherTests.search("ANTITHROMBIN");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+33.49);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Antithrombin 3: $33.49\n" );
            }
            var match = OtherTests.search("MONOSPOT");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+17.10);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Monospot: $17.10\n" );
            }
            var match = OtherTests.search("CERULOPLASM");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+10.15);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Ceruloplasmin: $10.15\n" );
            }
            var match = OtherTests.search("COPPER");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+49.19);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Copper: $49.19\n" );
            }
            var match = OtherTests.search("SERUM PROTEIN EL");
            var match2 = OtherTests.search("SPEP");
            if ((match != -1)||(match2 != -1)) {
               newcost = Math.round(($('#Costs').val()*1)+26.54);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"SPEP: $26.54\n" );
            }
            var match = OtherTests.search("TROPONIN");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+15.05);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Troponin: $15.05\n" );
            }
            var match = OtherTests.search("SEMEN");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+82.34);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Semenanalysis: $82.34\n" );
            }
            var match = OtherTests.search("VITAMIN D");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+61.32);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Vit D: $61.32\n" );
            }
            var match = OtherTests.search("HBEAG");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+14.87);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"HBeAg: $14.87\n" );
            }
            var match = OtherTests.search("ANTI-HBEAG");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+15.00);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Anti-HBeAg: $15.00\n" );
            }
            var match = OtherTests.search("HBV DNA");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+60.34);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"HBV DNA: $60.34\n" );
            }
            var match = OtherTests.search("DRVVT");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+14.01);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"DRVVT: $14.01\n" );
            }
            var match = OtherTests.search("BNP");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+42.56);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"BNP: $42.56\n" );
            }
            var match = OtherTests.search("PHOSPHATE");
            var match2 = OtherTests.search("PO4");
            if ((match != -1)||(match2 != -1)) {
               newcost = Math.round(($('#Costs').val()*1)+1.64);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"PO4: $1.64\n" );
            }
            var match = OtherTests.search("TESTOSTERONE");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+15.81);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Testosterone: $15.81\n" );
            }
            var match = OtherTests.search("URINARY CALCIUM");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+5.48);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Urine Calcium: $5.48\n" );
            }
            var match = OtherTests.search("DHEA");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+18.55);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"DHEAS: $18.55\n" );
            }
            var match = OtherTests.search("VDRL");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+15.96);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"VDRL: $15.96\n" );
            }
            var match = OtherTests.search("ESTRADIOL");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+22.43);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Estradiol: $22.43\n" );
            }
            var match = OtherTests.search("AFP");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+24.79);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"AFP: $24.79\n" );
            }
            var match = OtherTests.search("CEA");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+20.40);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"CEA: $20.40\n" );
            }
            var match = OtherTests.search("RF");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+8.41);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"RF: $8.41\n" );
            }
            var match = OtherTests.search("ANA");
            var match2 = OtherTests.search("ANALYSIS");
            if ((match != -1) && (match2 == -1)) {
               newcost = Math.round(($('#Costs').val()*1)+23.82);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"ANA: $23.82(base+$75 per autoAb)\n" );
            }
            var match = OtherTests.search("HEP C|HCV");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+10.00);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Hep C: ?$10.00\n" );
            }
            var match = OtherTests.search("RUBELLA");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+10.00);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Rubella: ?$10.00\n" );
            }
            var match = OtherTests.search("VZ");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+10.00);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"VZ IgG: ?$10.00\n" );
            }
            var match = OtherTests.search("RPR|SYPHILIS");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+10.00);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"RPR: ?$10.00\n" );
            }
            var match = OtherTests.search("ANTITRYPSIN");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+20.06);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Alpha-1 antitrypsin: $20.06\n" );
            }
            var match = OtherTests.search("MITOCHONDRIAL");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+23.82);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"Anti-mitochondrial AB: $23.82 + $27.03/Extra Ab\n" );
            }
            var match = OtherTests.search("LDH|LACTATE DEHYDROGENASE");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+1.62);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"LDH: $1.62\n" );
            }
            var match = OtherTests.search("DDIMER|D DIMER|D-DIMER");
            if (match != -1) {
               newcost = Math.round(($('#Costs').val()*1)+23.27);
               $('#Costs').val(newcost);
               AddIfMissingTitle('Costs',"D-dimer: $23.27\n" );
            }
             
            var match = OtherTests.search("ANA");
            var match2 = OtherTests.search("ANALYSIS");
            var dateANA = $('#ANADate').val();
            var valueANA = $('#ANAVal').val();
            if ((match != -1) && (match2 == -1)&&( $('#ANADate').val() != "")) {
                AddIfMissingTitle('PrintSubmitButton',"ANA was done "+dateANA+" ago. Result: "+valueANA+" .\nGenerally one does not need to repeat unless there is a change in clinical status or if another diagnosis is considered.\n" );
                $("#PrintSubmitButton").addClass('warning');
            }
 
            var match = OtherTests.search("RF");
            var dateRF = $('#RFDate').val();
            var valueRF = $('#RFVal').val();
            if ((match != -1)&&( $('#RFDate').val() != "")) {
               AddIfMissingTitle('PrintSubmitButton',"RF was done "+dateRF+" ago. Result: "+valueRF+" .\nGenerally one does not need to repeat unless there is a change in clinical status or if another diagnosis is considered.\n" );
                $("#PrintSubmitButton").addClass('warning');
            } 
            
            var match = OtherTests.search("TTG");
            var dateTTG = $('#TTGDate').val();
            var valueTTG = $('#TTGVal').val();
            if ((match != -1)&&( $('#TTGDate').val() != "")) {
               AddIfMissingTitle('PrintSubmitButton',"TTG was done "+dateTTG+" ago. Result: "+valueTTG+" .\nGenerally one does not need to repeat unless it is used to monitor a known patient with celiac disease.\n" );
                $("#PrintSubmitButton").addClass('warning');
            }
                        
         }, 1000);


}
