/***********************************************************************
*   LOCATION FUNCTION
*   PM Sep 2017
*   HN For LabRequisition Feb 2019
************************************************************************/

function setLabLocation(i) {
  var address="";	/* address = lab address */
  var lh="";		/* lh = lab hours */
  
  switch(i) {
    default:
		address="";
		lh="";
		break;
	  
	case "sardis":
		address = 'Satellite Lab Sardis, #5-6014 Vedder Rd,\nChilliwack, BC, (604) 824-9627';
		lh = 'Mon-Fri 7:00-4:30\nHolter-No, ECG-No\nSelf pay- No\nGTT-Yes, no appt needed';
		break;
	case "CGHHospital":
		address = 'Chilliwack General Hospital Lab\n 45600 Menholm Road\nChilliwack, BC';
		lh = 'Mon-Fri 7:30-4:00\nHolter-No, Self Pay-Yes, ECG- Yes\nGTT-Yes, no appt needed';
		break;
	case "BCBioChill":
		address = 'LifeLabs, 608-8236 Eagle Landing Parkway, Chilliwack, BC\n(604)792-4607, Fax: (604)792-6338';
		lh = 'Mon-Fri 6:30-5:00, Sat 7:00-12:00\nHolter-Yes 1-877-507-5595 to book\nECG-Yes/ Self Pay-Yes\nGTT-appt (604) 792-4607\nhttp://booking.lifelabs.com';
		break;
	case "BCBioAgg":
		address = 'LifeLabs, 1-7069 Cheam Ave,\nAggasiz, BC\n(604)796-8523\nFax: (604)796-8534';
		lh = 'Mon-Fri 7:00-1:30\nHolter-Yes 1-877-507-5595 to book\nECG-Yes/ Self Pay-Yes\nGTT-appt (604) 792-4607\nhttp://booking.lifelabs.com';
		break;
	case "BCBioAbbMac":
		address = 'LifeLabs, 103-2151 McCallum Road,\nAbbotsford, BC\n(604) 853-6371\nFax: (604) 853-6377';
		lh = 'Mon-Fri 6:30-5:30\nSat+Sun 7:00-12:00\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "BCBioAbbSim":
		address = 'LifeLabs, 201-32475 Simon Ave,\nAbbotsford, BC\n(604) 855-0108\nFax: (604) 850-0386';
		lh = 'Mon-Fri 7:00-5:00\nSat+Sun 7:00-12:00\nhttp://booking.lifelabs.com';
		break;
	case "BCBioAbbCle":
		address = 'LifeLabs, 207-2825 Clearbrook Rd,\nAbbotsford, BC\n(604) 852-9026\nFax: (604) 853-0953';
		lh = 'Mon-Fri 7:00-3:00\nSat+Sun Closed\nhttp://booking.lifelabs.com';
		break;
	case "BCBioNW5":
		address = 'LifeLabs, 508-625 Fifth Ave,\nNew Westminster, BC\n(604) 526-2831\nFax: (604) 525-3417';
		lh = 'Mon-Fri 6:30-5:00\nSat 7:00-2:00\nHolter available\nhttp://booking.lifelabs.com';
 		break;
	case "BCBioNWSap":
		address = "LifeLabs, 227 Nelson's Crescent,\nNew Westminster, BC\n(604) 522-8941\nFax: (604) 522-9917";
		lh = 'Mon-Fri 8:00-4:00\nSat Closed\nhttp://booking.lifelabs.com';
 		break;
	case "BCBioBbySq":
		address = 'LifeLabs, 104-7885 Sixth St,\nBurnaby, BC\n(604) 526-0205\nFax: (604) 526-0209';
		lh = 'Mon-Fri 7:30-4:00\nSat Closed\nhttp://booking.lifelabs.com';
		break;
	case "RCHOut":
		address = 'RCH Outpatient Lab, 330 E. Columbia St, \nNew Westminster, BC  V3L 3W7 \n(604) 520-4300\nFax: (604) 520-4864';
		lh = 'Mon-Fri 7:00-4:30\nSat + Sun 10:00-3:00';
		break;
	case "ERHOut":
		address = 'ERH Outpatient Lab, 475 Guildford Way, \nPort Moody, BC  V3H 3W9 \n(604) 469-3143\nFax: (604) 469-5131';
		lh = 'Mon-Fri 8:30-4:00\nSat + Sun 9:30-12:30';
		break;
	case "BCBioMob":
		address = 'LifeLabs MOBILE LABS \nBby, Tri-Cities, Ridge Meadows, New West, Vancouver\n604) 939-7352  Fax: (604) 939-4257'; 
		break;
	case "BCBioMob_ValleyWest":
		address = 'LifeLabs MOBILE LABS \nAbbotsford, Aldergrove, Clearbrook, Mission\n604) 859-5538  Fax: (604) 864-9316'; 
		break;
	case "BCBioMob_ValleyEast":
		address = 'LifeLabs MOBILE LABS \nAgassiz, Chilliwack, Harrison, Sardis, Yarrow\n604) 792-4614  Fax: (604) 792-2553'; 
		break;
	case "BCBioMob_FraserSouth":
		address = 'LifeLabs MOBILE LABS \nDelta, Langley, Surrey, White Rock\n604) 531-8941  Fax: (604) 535-5947'; 
		break;
	case "MDSMob": 
		address = 'LifeLabs MOBILE LABS \nLower Mainland \n(604) 412-4495  Fax: (604) 412-4441';
		lh = 'Fax request: "Attention Mobile Lab Service"';
		break;
	case "BCBioCoqAus": 
		address = 'LifeLabs, 106-1015 Austin Ave,\nCoquitlam, BC\n(604) 937-3913\nFax: (604) 937-3849';
		lh = 'Mon-Fri 7:00-5:00\nSat 7:00-2:00\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "BCBioCoqNor":
		address = 'LifeLabs, Suite R-435 North Road (Cariboo Centre), Coquitlam, BC\n(604) 939-7362 Fax: (604) 939-2073';
		lh = 'Mon-Fri 8:00-4:30\nSat+Sun 7:00-12:00\nhttp://booking.lifelabs.com';
		break;
	case "LifeLabCoqBur":
		address = 'LifeLabs, 536 Clarke Road,\nCoquitlam, BC\n(604) 936-7355\nFax: (604) 516-2216';
		lh = 'Mon-Fri 7:30-5:00\nSat 7:30-1:00 \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabCoqGor":
		address = 'LifeLabs, 208-3001 Gordon Ave,\nCoquitlam, BC\n(604) 464-1814\nFax: (604) 464-8537';
		lh = 'Mon-Fri 7:00-5:00\nSat 7:00-1:00 \nSun 8:00-12:00 \nhttp://booking.lifelabs.com';
		break;
	case "BCBioCoqLan":
		address = 'LifeLabs, 313-1194 Lansdowne Drive,\nCoquitlam, BC\n(604) 944-1324\nFax: (604) 468-4359';
		lh = 'Mon-Fri 6:30-5:00\nSat+Sun 7:00-12:00\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "BCBioPMStJ":
		address = 'LifeLabs, 101-2624 St. Johns St,\nPort Moody, BC\n(604) 931-5644\nFax: (604) 931-1284';
		lh = 'Mon-Fri 7:30-3:30\nSat+Sun Closed\nhttp://booking.lifelabs.com';
		break;
	case "BCBioPocoWil":
		address = 'LifeLabs, 7-2185 Wilson Ave,\nPort Coquitlam, BC\n(604) 944-7754\nFax: (604) 941-0543';
		lh = 'Mon-Fri 6:30-5:00\nSat+Sun 7:00-12:00\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "BCBioPocoSal":
		address = 'LifeLabs, 115-1465 Salisbury Ave,\nPort Coquitlam, BC\n(604) 941-4313\nFax: (604) 941-0514';
		lh = 'Mon-Fri 8:00-4:00\nSat Closed\nhttp://booking.lifelabs.com';
		break;
	case "BCBioPitMed":
		address = 'LifeLabs, 102-12195 Harris Road,\nPitt Meadows, BC\n(604) 465-7873\nFax: (604) 465-0493';
		lh = 'Mon-Fri 8:00-4:00\nSat Closed\nhttp://booking.lifelabs.com';
		break;
	case "BCBioMapR":
		address = 'LifeLabs, 101-11743 - 224 St,\nMaple Ridge, BC\n(604) 467-5141\nFax: (604) 467-3685';
		lh = 'Mon-Fri 6:30-5:00\nSat 7:00-12:00\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "BCBioMission":
		address = 'LifeLabs, 103-7343 Hurd St,\nMission, BC\n(604) 826-7197\nFax: (604) 820-2735';
		lh = 'Mon-Fri 7:30-4:00\nSat Closed\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "BCBioBbyMet":
		address = 'LifeLabs, 201-4980 Kingsway (Nelson+Bennett), Burnaby, BC\n(604) 433-6511\nFax: (604) 433-5834';
		lh = 'Mon-Fri 6:30-6:00\nSat 7:00-2:00, Sun 7:00-12:00\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "BCBioBbyNel":
		address = 'LifeLabs, 206-6411 Nelson Ave,\nBurnaby, BC\n(604) 435-5149\nFax: (604) 431-0479';
		lh = 'Mon-Fri 6:30-3:00\nSat Closed\nhttp://booking.lifelabs.com';
		break;
	case "BCBioBbyKen":
		address = 'LifeLabs, 203-6542 E. Hastings St,\nBurnaby, BC\n(604) 294-6686\nFax: (604) 294-6652';
		lh = 'Mon-Fri 7:30-4:00\nSat 7:00-12:00\nhttp://booking.lifelabs.com';
		break;
	case "BCBioBbyNor":
		address = 'LifeLabs, 103-4012 E. Hastings St,\nBurnaby, BC\n(604) 294-5005\nFax: (604) 294-5006';
		lh = 'Mon-Fri 7:30-4:00\nSat 7:00-12:00\nhttp://booking.lifelabs.com';
		break;
	case "LifeLabBbyCenP":
		address = 'LifeLabs, 302-3965 Kingsway,\nBurnaby, BC\n(604) 439-9642\nFax: (604) 437-1289';
		lh = 'Mon-Fri 7:00-4:30\nSat 7:00-12:00  \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabBbyHas":
		address = 'LifeLabs, 324 Gilmore Ave,\nBurnaby, BC\n(604) 298-3933\nFax: (604) 205-7043';
		lh = 'Mon-Fri 7:00-6:00\nSat 7:00-3:00  \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabDelHar":
		address = 'LifeLabs, 104-4515 Harvest Dr,\nDelta, BC\n(604) 946-2144\nFax: (604) 502-1738';
		lh = 'Mon-Fri 7:00-4:00\nSat 7:00-1:00 \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabDel56":
		address = 'LifeLabs, 114-1077 - 56th St,\nDelta, BC\n(604) 943-7033\nFax: (604) 502-1104';
		lh = 'Mon-Fri 8:00-4:00\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "BCBioDel84":
		address = 'LifeLabs, 201-8425 - 120th St,\nSurrey, BC\n(604) 591-3304\nFax: (604) 599-3925';
		lh = 'Mon-Fri 6:30-6:00\nSat 7:00-2:00; Sun 7:00-12:00\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "BCBioDel63":
		address = 'LifeLabs, 122-6345 - 120th St,\nSurrey, BC\n(604) 597-7884\nFax: (604) 543-2971';
		lh = 'Mon-Fri 7:30-4:00\nSat 7:00-12:00\nhttp://booking.lifelabs.com';
		break;
	case "LifeLabClov":
		address = 'LifeLabs, 102-17760 - 56th Ave,\nSurrey, BC\n(604) 576-6111\nFax: (604) 502-2136';
		lh = 'Mon-Fri 6:30-5:00\nSat 7:00-2:00; Sun 7:00-2:00 \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabSurSat":
		address = 'LifeLabs, 113-7130 120th St,\nSurrey, BC\n(604) 543-5280\nFax: (604) 543-3280';
		lh = 'Mon-Fri 8:00-4:00\nSat 8:00-1:00; Sun 8:00-1:00 \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabSurCed":
		address = 'LifeLabs, 103-9648 128th St,\nSurrey, BC\n(604) 585-7404\nFax: (604) 581-1587';
		lh = 'Mon-Fri 8:00-4:00\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabSurNor":
		address = 'LifeLabs, 201-12080 Nordel Way,\nSurrey, BC\n(604) 591-6717\nFax: (604) 502-7598';
		lh = 'Mon-Fri 7:00-5:00\nSat 7:30-3:00 \nhttp://booking.lifelabs.com';
		break;
	case "BCBioSurCen":
		address = 'LifeLabs, 101-10166 King George Blvd,\nSurrey, BC\n(604) 589-2226\nFax: (604) 589-2260';
		lh = 'Mon-Fri 7:30-3:30\nSat Closed\nhttp://booking.lifelabs.com';
		break;
	case "BCBioSurKG":
		address = 'LifeLabs, 101-9656 King George Blvd,\nSurrey, BC\n(604) 588-3494\nFax: (604) 584-1396';
		lh = 'Mon-Fri 6:30-5:30\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "BCBioSurGui":
		address = 'LifeLabs, 19-15300 - 105th Ave,\nSurrey, BC\n(604) 581-5711\nFax: (604) 584-5714';
		lh = 'Mon-Fri 7:00-5:00\nSat 7:00-12:00\nhttp://booking.lifelabs.com';
		break;
	case "BCBioSurNew":
		address = 'LifeLabs, 124-13745 - 72nd Ave,\nSurrey, BC\n(604) 591-8618\nFax: (604) 572-0485';
		lh = 'Mon-Fri 6:30-5:00\nSat 7:00-2:00; Sun 7:00-12:00\nhttp://booking.lifelabs.com';
		break;
	case "BCBioHeal":
		address = 'LifeLabs, 202-13798 - 94A Ave,\nSurrey, BC\n(604) 589-2226\nFax: (604) 589-2260';
		lh = 'Mon-Fri 8:30-4:00\nSat Closed\nhttp://booking.lifelabs.com';
		break;
	case "BCBioSurFlee":
		address = 'LifeLabs, 204-9014 - 152nd St,\nSurrey, BC\n(604) 583-4265\nFax: (604) 583-7253';
		lh = 'Mon-Fri 6:30-4:30\nSat 7:00-2:00; Sun 7:00-12:00\nhttp://booking.lifelabs.com';
		break;
	case "BCBioSurHaz":
		address = 'LifeLabs, 202-16088 - 84th Ave,\nSurrey, BC\n(604) 572-4359\nFax: (604) 572-4859';
		lh = 'Mon-Fri 8:00-4:00\nSat Closed\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "BCBioSurMor":
		address = 'LifeLabs, 112-15252 - 32nd Ave,\nSurrey, BC\n(604) 531-7737\nFax: (604) 531-7750';
		lh = 'Mon-Fri 7:30-4:00\nSat 7:00-12:00\nhttp://booking.lifelabs.com';
		break;
	case "LifelabWR":
		address = 'LifeLabs, 105-1656 Martin Dr,\nWhite Rock, BC\n(604) 538-4990\nFax: (604) 538-3497';
		lh = 'Mon-Fri 6:30-5:00\nSat 7:00-1:00 \nhttp://booking.lifelabs.com';
		break;
	case "BCBioWRPea":
		address = 'LifeLabs, 120-15321 - 16th Ave,\nWhite Rock, BC\n(604) 531-0737 Fax: (604) 531-0751';
		lh = 'Mon-Fri 7:00-5:00\nSat 7:00-12:00\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "BCBioLanDoug":
		address = 'LifeLabs, 209-5503 - 206th St,\nLangley, BC\n(604) 534-8671\nFax: (604) 532-3017';
		lh = 'Mon-Fri 6:30-5:30\nSat 7:00-12:00\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "BCBioLanWill":
		address = 'LifeLabs, 130-19653 Willowbrook Dr,\nLangley, BC\n(604) 534-8667\nFax: (604) 534-9253';
		lh = 'Mon-Fri 7:00-3:30\nSat-Sun 7:00-12:00\nhttp://booking.lifelabs.com';
		break;
	case "BCBioLanBroo":
		address = 'LifeLabs, 105-20103 - 40th Ave,\nLangley, BC\n(604) 533-1617\nFax: (604) 533-1631';
		lh = 'Mon-Fri 7:00-3:30\nSat Closed\nhttp://booking.lifelabs.com';
		break;
	case "BCBioLanWal":
		address = 'LifeLabs, 102B-20999 - 88th Ave,\nLangley, BC\n(604) 882-0426\nFax: (604) 882-3910';
		lh = 'Mon-Fri 7:00-5:00\nSat 7:00-12:00\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanDis":
		address = 'LifeLabs, 4305 W. 10th Ave,\nVancouver, BC\n(604) 228-9412\nFax: (604) 228-4902';
		lh = 'Mon-Fri 8:30-4:30\nSat 8:00-12:30 \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanKer":
		address = 'LifeLabs, 2061 W. 42nd Ave,\nVancouver, BC\n(604) 263-7742\nFax: (604) 261-5374';
		lh = 'Mon-Fri 8:00-4:30\nSat 8:00-1:00 \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanDun":
		address = 'LifeLabs, 112-3540 W. 41st Ave,\nVancouver, BC\n(604) 264-9815\nFax: (604) 263-2965';
		lh = 'Mon-Fri 8:30-5:00\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanReg":
		address = 'LifeLabs, 290-2184 W. Broadway,\nVancouver, BC\n(604) 738-7911\nFax: (604) 714-5976';
		lh = 'Mon-Fri 7:30-5:00\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanLau":
		address = 'LifeLabs, 104-888 W. 8th Ave,\nVancouver, BC\n(604) 876-7911\nFax: (604) 708-5645';
		lh = 'Mon-Fri 8:30-4:00\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanFair":
		address = 'LifeLabs, 701-750 W. Broadway,\nVancouver, BC\n(604) 877-1707\nFax: (604) 871-1549';
		lh = 'Mon-Fri 7:00-5:00\nSat 7:00-3:00 \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanWB":
		address = 'LifeLabs, 200-943 W. Broadway,\nVancouver, BC\n(604) 734-1826\nFax: (604) 714-0361';
		lh = 'Mon-Fri 9:00-5:00\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "BCBioVanBroP":
		address = 'LifeLabs, 410-1338 W. Broadway,\nVancouver, BC\n(604) 731-9166\nFax: (604) 731-3214';
		lh = 'Mon-Fri 8:00-12:00, 1:00-4:00\nSat Closed\nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanSF":
		address = 'LifeLabs, 6540 Fraser St,\nVancouver, BC\n(604) 325-4814\nFax: (604) 301-0127';
		lh = 'Mon-Fri 7:30-5:00\nSat 7:30-3:30 \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanVic":
		address = 'LifeLabs, 5786 Victoria Dr,\nVancouver, BC\n(604) 324-0728\nFax: (604) 324-0727';
		lh = 'Mon-Fri 6:00-4:30\nSat 7:00-3:00; Sun 7:00-12:00 \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanCha":
		address = 'LifeLabs, 340-3150 E. 54th Ave,\nVancouver, BC\n(604) 267-2001\nFax: (604) 433-7509';
		lh = 'Mon-Fri 8:00-4:00\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "BCBioVanCom":
		address = 'LifeLabs, 306-1750 E. 10th Ave,\nVancouver, BC\n(604) 873-2651\nFax: (604) 871-0865';
		lh = 'Mon-Fri 7:00-5:00\nSat 7:00-12:00\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVan3P":
		address = 'LifeLabs, 408 E. Hastings St,\nVancouver, BC\n(604) 738-7301\nFax: (604) 738-7308';
		lh = 'Mon-Fri 8:00-4:00\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanKee":
		address = 'LifeLabs, 204-180 Keefer St,\nVancouver, BC\n(604) 685-7473\nFax: (604) 915-7029';
		lh = 'Mon-Fri 7:00-4:30\nSat 7:00-3:00 \nhttp://booking.lifelabs.com';
		break;
	case "BCBioVanEHas":
		address = 'LifeLabs, 2736 E. Hastings St,\nVancouver, BC\n(604) 253-1914\nFax: (604) 709-1075';
		lh = 'Mon-Fri 7:30-4:00\nSat Closed\nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanMar":
		address = 'LifeLabs, 8677 Granville St,\nVancouver, BC\n(604) 266-7177\nFax: (604) 261-8571';
		lh = 'Mon-Fri 8:00-4:00\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanOak":
		address = 'LifeLabs, 215-650 W. 41st Ave,\nVancouver, BC\n(604) 261-1022\nFax: (604) 261-7937';
		lh = 'Mon-Fri 7:00-4:30\nSat 7:30-3:30 \nhttp://booking.lifelabs.com';
		break;
	case "BCBioVanWill":
		address = 'LifeLabs, 50-809 W. 41st Ave,\nVancouver, BC\n(604) 263-4912\nFax: (604) 263-4921';
		lh = 'Mon-Fri 8:00-1:00\nSat Closed\nhttp://booking.lifelabs.com';
		break;
	case "BCBioVanOakridge":
		address = 'LifeLabs, 33-5740 Cambie St,\nVancouver, BC\n(604) 327-2033\nFax: (604) 327-6641';
		lh = 'Mon-Fri 7:30-4:00\nSat 7:00-12:00\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "BCBioVanKinE":
		address = 'LifeLabs, 972 W. King Edward Ave,\nVancouver, BC\n(604) 263-4912\nFax: (604) 263-4921';
		lh = 'Mon-Fri 7:30-3:30\nSat Closed\nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanLitMo":
		address = 'LifeLabs, 4527 Main St,\nVancouver, BC\n(604) 874-1919\nFax: (604) 875-6247';
		lh = 'Mon-Fri 8:00-3:30\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "BCBioVanStP":
		address = 'LifeLabs, 206-1160 Burrard St,\nVancouver, BC\n(604) 689-1012\nFax: (604) 689-2947';
		lh = 'Mon-Fri 7:00-5:00\nSat Closed\nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanStP":
		address = 'LifeLabs, 208-1200 Burrard St,\nVancouver, BC\n(604) 684-3668\nFax: (604) 605-0873';
		lh = 'Mon-Fri 8:00-4:00\nSat 8:00-1:00 \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanWGeo":
		address = 'LifeLabs, 835-777 Hornby St,\nVancouver, BC\n(604) 682-4811\nFax: (604) 915-9059';
		lh = 'Mon-Fri 7:00-3:00\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "BCBioVanCityS":
		address = 'LifeLabs, 163-555 W. 12th Ave,\nVancouver, BC\n(604) 709-6131\nFax: (604) 709-6136';
		lh = 'Mon-Fri 7:30-4:00\nSat 7:00-12:00\nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanCityV":
		address = 'LifeLabs, 2-1530 W. 7th Ave,\nVancouver, BC\n(604) 738-0414\nFax: (604) 731-4183';
		lh = 'Mon-Fri 8:00-4:00\nSat 8:00-1:00 \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanMyc":
		address = 'LifeLabs, 108-3195 Granville St,\nVancouver, BC\n(604) 738-9045\nFax: (604) 714-0375';
		lh = 'Mon-Fri 9:00-12:30/1:30-4:30\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "BCBioVanYale":
		address = 'LifeLabs, 136 Davie St,\nVancouver, BC\n(604) 687-4334\nFax: (604) 687-4337';
		lh = 'Mon-Fri 7:00-3:30\nSat Closed\nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanLons":
		address = 'LifeLabs, 215-1916 Lonsdale Ave,\nNorth Vancouver, BC\n(604) 980-3621\nFax: (604) 904-2318';
		lh = 'Mon-Fri 6:30-5:00\nSat 7:00-3:00 \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanLynn":
		address = 'LifeLabs, 209-1200 Lynn Valley Rd,\nNorth Vancouver, BC\n(604) 903-4940\nFax: (604) 980-4270';
		lh = 'Mon-Fri 8:00-4:00\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanParkg":
		address = 'LifeLabs, 201-3650 Mount Seymour Pkwy,\nNorth Vancouver, BC\n(604) 929-1360\nFax: (604) 903-9155';
		lh = 'Mon-Fri 7:00-3:30\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanHolly":
		address = 'LifeLabs, 109-575 - 16th St,\nWest Vancouver, BC\n(604) 903-4920\nFax: (604) 921-4652';
		lh = 'Mon-Fri 7:30-5:00\nSat 7:30-3:30 \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabVanDundar":
		address = 'LifeLabs, 115-2419 Bellevue Ave,\nWest Vancouver, BC\n(604) 925-2811\nFax: (604) 925-5179';
		lh = 'Mon-Fri 7:30-3:30\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabRichBus":
		address = 'LifeLabs, 170-6451 Buswell St,\nRichmond, BC\n(604) 273-6511\nFax: (604) 207-0143';
		lh = 'Mon-Fri 7:00-5:00\nSat 7:00-3:00 \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabRich2":
		address = 'LifeLabs, 172-6180 Blundell Rd,\nRichmond, BC\n(604) 713-3130\nFax: (604) 709-2234';
		lh = 'Mon-Fri 7:00-5:00\nSat 7:00-12:00 \nhttp://booking.lifelabs.com';
		break;
	case "BCBioRichAber":
		address = 'LifeLabs, 1150-4151 Hazelbridge Way,\nRichmond, BC\n(604) 232-5585\nFax: (604) 232-5589';
		lh = 'Mon-Fri 7:30-3:30\nSat 7:00-12:00\nHolter available\nhttp://booking.lifelabs.com';
		break;
	case "LifeLabRichSteves":
		address = 'LifeLabs, 104-3811 Chatham Rd,\nRichmond, BC\n(604) 271-1712\nFax: (604) 709-2293';
		lh = 'Mon-Fri 7:00-4:00\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabRichCrest":
		address = 'LifeLabs, 107-6051 Gilbert Rd,\nRichmond, BC\n(604) 278-5412\nFax: (604) 207-1074';
		lh = 'Mon-Fri 8:00-4:00\nSat Closed \nhttp://booking.lifelabs.com';
		break;
	case "LifeLabRich3":
		address = 'LifeLabs, 200-5791 No. 3 Rd,\nRichmond, BC\n(604) 278-6516\nFax: (604) 207-1082';
		lh = 'Mon-Fri 6:00-5:00\nSat 7:00-3:00; Sun 7:00-12:00 \nhttp://booking.lifelabs.com';
		break;
	case "BCBioRichAld":
		address = 'LifeLabs, 27127 Fraser Hwy,\nAldergrove, BC\n(604) 856-0322\nFax: (604) 856-3694';
		lh = 'Mon-Fri 7:00-3:30\nSat+Sun Closed\nhttp://booking.lifelabs.com';
		break;
	case "KamloopsMob": 
		address = 'LifeLabs, MOBILE LABS \nKamloops \n(250) 374-1644 ext. 3  Fax: (250) 374-5638';
		lh = 'Fax request: "Attention Mobile Lab Service"';
		break;
	case "PrinceGeorgeMob": 
		address = 'LifeLabs, MOBILE LABS \nPrince George \n(250) 562-4191 Fax: (250) 562-7358';
		lh = 'Fax request: "Attention Mobile Lab Service"';
		break;
	case "VictoriaSookeMob": 
		address = 'LifeLabs, MOBILE LABS \nVictoria, Sooke \n(250) 881-3113 Fax: (250) 881-3116';
		lh = 'Fax request: "Attention Mobile Lab Service"';
		break;
	case "NanaimoLantzvilleMob": 
		address = 'LifeLabs, MOBILE LABS \nCentral Nanaimo, Lantzville \nFax: (250) 753-3242';
		lh = 'Fax request: "Attention Mobile Lab Service"';
		break;
	case "ParksvilleEtcMob": 
		address = 'LifeLabs, MOBILE LABS \nParksville, Port Alberni\nQualicum Beach, Nanoose Bay \n(250) 248-2913 Fax: (250) 248-2652';
		lh = 'Fax request: "Attention Mobile Lab Service"';
		break;
	case "CourtenayMob": 
		address = 'LifeLabs, MOBILE LABS \nCourtenay \n(250) 334-4745 Fax: (250) 334-4637';
		lh = 'Fax request: "Attention Mobile Lab Service"';
		break;
	case "CampbellRiverMob": 
		address = 'LifeLabs, MOBILE LABS \nCampbell River \nFax: (250) 287-3202';
		lh = 'Fax request: "Attention Mobile Lab Service"';
		break;
  }

  document.FormName.LabLocation.value = address; 
  document.FormName.LabHours.value = lh; 
}


					