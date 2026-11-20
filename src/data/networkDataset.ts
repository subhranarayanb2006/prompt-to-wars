import { NetworkDataset } from '../types/network';
import { parseTime } from '../utils/time';

const t = parseTime;

export const DEFAULT_DATASET: NetworkDataset = {
  name: 'Domino Sky — India Domestic Network (16 Airports · 70 Flights · 16 Aircraft)',
  airports: [
    { code: 'BOM', name: 'Chhatrapati Shivaji Maharaj Intl', city: 'Mumbai', tier: 'hub', lat: 19.0896, lon: 72.8656, mctMinutes: 45 },
    { code: 'DEL', name: 'Indira Gandhi Intl', city: 'Delhi', tier: 'hub', lat: 28.5562, lon: 77.1000, mctMinutes: 45 },
    { code: 'BLR', name: 'Kempegowda Intl', city: 'Bengaluru', tier: 'hub', lat: 13.1986, lon: 77.7066, mctMinutes: 45 },
    { code: 'HYD', name: 'Rajiv Gandhi Intl', city: 'Hyderabad', tier: 'hub', lat: 17.2403, lon: 78.4294, mctMinutes: 45 },
    { code: 'CCU', name: 'Netaji Subhas Chandra Bose Intl', city: 'Kolkata', tier: 'regional', lat: 22.6547, lon: 88.4467, mctMinutes: 45 },
    { code: 'MAA', name: 'Chennai Intl', city: 'Chennai', tier: 'regional', lat: 12.9941, lon: 80.1709, mctMinutes: 45 },
    { code: 'AMD', name: 'Sardar Vallabhbhai Patel Intl', city: 'Ahmedabad', tier: 'regional', lat: 23.0732, lon: 72.6347, mctMinutes: 40 },
    { code: 'PNQ', name: 'Pune Intl', city: 'Pune', tier: 'regional', lat: 18.5821, lon: 73.9197, mctMinutes: 40 },
    { code: 'COK', name: 'Cochin Intl', city: 'Kochi', tier: 'regional', lat: 10.1520, lon: 76.4019, mctMinutes: 40 },
    { code: 'GOI', name: 'Goa Dabolim', city: 'Goa', tier: 'spoke', lat: 15.3808, lon: 73.8314, mctMinutes: 35 },
    { code: 'JAI', name: 'Jaipur Intl', city: 'Jaipur', tier: 'spoke', lat: 26.8242, lon: 75.8122, mctMinutes: 35 },
    { code: 'LKO', name: 'Chaudhary Charan Singh Intl', city: 'Lucknow', tier: 'spoke', lat: 26.7606, lon: 80.8893, mctMinutes: 35 },
    { code: 'GAU', name: 'Lokpriya Gopinath Bordoloi Intl', city: 'Guwahati', tier: 'spoke', lat: 26.1061, lon: 91.5859, mctMinutes: 35 },
    { code: 'PAT', name: 'Jay Prakash Narayan Intl', city: 'Patna', tier: 'spoke', lat: 25.5913, lon: 85.0880, mctMinutes: 35 },
    { code: 'BBI', name: 'Biju Patnaik Intl', city: 'Bhubaneswar', tier: 'spoke', lat: 20.2444, lon: 85.8178, mctMinutes: 35 },
    { code: 'IXC', name: 'Shaheed Bhagat Singh Intl', city: 'Chandigarh', tier: 'spoke', lat: 30.6735, lon: 76.7885, mctMinutes: 35 },
  ],

  aircraft: [
    { id: 'VT-DSA', model: 'A320neo', capacity: 180, homeBase: 'DEL', minTurnaroundMin: 35 },
    { id: 'VT-DSB', model: 'A321neo', capacity: 220, homeBase: 'BLR', minTurnaroundMin: 40 },
    { id: 'VT-DSC', model: 'A320neo', capacity: 180, homeBase: 'HYD', minTurnaroundMin: 35 },
    { id: 'VT-DSD', model: 'B737-8', capacity: 186, homeBase: 'DEL', minTurnaroundMin: 35 },
    { id: 'VT-DSE', model: 'A321neo', capacity: 220, homeBase: 'CCU', minTurnaroundMin: 40 },
    { id: 'VT-DSF', model: 'A320neo', capacity: 180, homeBase: 'MAA', minTurnaroundMin: 35 },
    { id: 'VT-DSG', model: 'A320neo', capacity: 180, homeBase: 'BOM', minTurnaroundMin: 35 },
    { id: 'VT-DSH', model: 'B737-8', capacity: 186, homeBase: 'DEL', minTurnaroundMin: 35 },
    { id: 'VT-DSI', model: 'A320neo', capacity: 180, homeBase: 'BLR', minTurnaroundMin: 35 },
    { id: 'VT-DSJ', model: 'A320neo', capacity: 180, homeBase: 'HYD', minTurnaroundMin: 35 },
    { id: 'VT-DSK', model: 'A321neo', capacity: 220, homeBase: 'AMD', minTurnaroundMin: 40 },
    { id: 'VT-DSL', model: 'B737-8', capacity: 186, homeBase: 'CCU', minTurnaroundMin: 35 },
    { id: 'VT-DSM', model: 'A320neo', capacity: 180, homeBase: 'PNQ', minTurnaroundMin: 35 },
    { id: 'VT-DSN', model: 'A320neo', capacity: 180, homeBase: 'COK', minTurnaroundMin: 35 },
    { id: 'VT-DSO', model: 'B737-8', capacity: 186, homeBase: 'LKO', minTurnaroundMin: 35 },
    { id: 'VT-DSP', model: 'A320neo', capacity: 180, homeBase: 'IXC', minTurnaroundMin: 35 },
  ],

  crews: [
    // CR-01 operates VT-DSA's 5-leg chain (DEL->BOM->BLR->HYD->BLR->CCU).
    // Report 05:00, sched debrief 17:30 (750m). Legal FDTL 775m (expires 17:55).
    // A 90m BOM storm pushes DS-105 debrief past 17:55 -> FDTL Cancellation on BLR->CCU!
    { id: 'CR-01', name: 'Capt. A. Nair / FO R. Verma', base: 'DEL', maxDutyMinutes: 775, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
    // CR-02 operates VT-DSB (BLR->BOM->AMD->BOM->DEL->LKO). Tight evening FDTL -> DS-205 vulnerable!
    { id: 'CR-02', name: 'Capt. S. Kulkarni / FO M. Iyer', base: 'BLR', maxDutyMinutes: 740, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
    // CR-03 operates DS-301, DS-302 (HYD->BOM->DEL on VT-DSC), then transfers at DEL to VT-DSJ for DS-1003, DS-1004!
    { id: 'CR-03', name: 'Capt. V. Reddy / FO K. Rao', base: 'HYD', maxDutyMinutes: 755, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
    // CR-04 operates VT-DSD (DEL->BLR->COK->BLR->BOM->GOI)
    { id: 'CR-04', name: 'Capt. P. Malhotra / FO A. Singh', base: 'DEL', maxDutyMinutes: 760, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
    // CR-05 operates VT-DSE (CCU->DEL->BOM->MAA->BLR->HYD)
    { id: 'CR-05', name: 'Capt. R. Banerjee / FO S. Das', base: 'CCU', maxDutyMinutes: 795, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
    // CR-06 operates VT-DSF (MAA->HYD->DEL->IXC->DEL->CCU)
    { id: 'CR-06', name: 'Capt. K. Subramanian / FO D. Menon', base: 'MAA', maxDutyMinutes: 735, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
    // CR-07 operates VT-DSG (BOM->GOI->BOM->HYD->CCU)
    { id: 'CR-07', name: 'Capt. N. Deshmukh / FO T. Joshi', base: 'BOM', maxDutyMinutes: 610, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
    // CR-08 operates VT-DSH (DEL->GAU->CCU->BBI->DEL)
    { id: 'CR-08', name: 'Capt. H. Sharma / FO G. Chauhan', base: 'DEL', maxDutyMinutes: 685, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
    // CR-09 operates VT-DSI (BLR->MAA->CCU->GAU->BLR)
    { id: 'CR-09', name: 'Capt. R. Shetty / FO P. Hegde', base: 'BLR', maxDutyMinutes: 725, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
    // CR-10 operates DS-1001, DS-1002 (HYD->PNQ->DEL on VT-DSJ), then transfers at DEL to VT-DSC for DS-303, DS-304, DS-305!
    { id: 'CR-10', name: 'Capt. M. Naidu / FO S. Prasad', base: 'HYD', maxDutyMinutes: 710, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
    // CR-11 operates VT-DSK (AMD->DEL->HYD->MAA->BOM)
    { id: 'CR-11', name: 'Capt. D. Patel / FO J. Shah', base: 'AMD', maxDutyMinutes: 690, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
    // CR-12 operates VT-DSL (CCU->PAT->DEL->BLR->PNQ)
    { id: 'CR-12', name: 'Capt. A. Sen / FO B. Ghosh', base: 'CCU', maxDutyMinutes: 685, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
    // CR-13 operates VT-DSM (PNQ->BLR->DEL->BOM->JAI)
    { id: 'CR-13', name: 'Capt. Y. Gokhale / FO V. Pawar', base: 'PNQ', maxDutyMinutes: 775, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
    // CR-14 operates VT-DSN (COK->BOM->CCU->HYD->BBI)
    { id: 'CR-14', name: 'Capt. J. Mathew / FO A. Thomas', base: 'COK', maxDutyMinutes: 745, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
    // CR-15 operates VT-DSO (LKO->BOM->PNQ->HYD->BLR)
    { id: 'CR-15', name: 'Capt. U. Tiwari / FO R. Mishra', base: 'LKO', maxDutyMinutes: 590, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
    // CR-16 operates VT-DSP (IXC->BOM->HYD->GOI->DEL)
    { id: 'CR-16', name: 'Capt. G. Gill / FO S. Sandhu', base: 'IXC', maxDutyMinutes: 725, reportBeforeFirstFlightMin: 45, debriefAfterLastFlightMin: 15 },
  ],

  flights: [
    // === AIRCRAFT 1: VT-DSA (5 legs) — Headline Mumbai Storm -> Bengaluru-Kolkata Cancellation Chain ===
    { id: 'DS-101', origin: 'DEL', dest: 'BOM', aircraftId: 'VT-DSA', crewId: 'CR-01', schedDep: t('05:45'), schedArr: t('07:50'), passengers: 164 },
    { id: 'DS-102', origin: 'BOM', dest: 'BLR', aircraftId: 'VT-DSA', crewId: 'CR-01', schedDep: t('08:30'), schedArr: t('10:15'), passengers: 172 },
    { id: 'DS-103', origin: 'BLR', dest: 'HYD', aircraftId: 'VT-DSA', crewId: 'CR-01', schedDep: t('10:55'), schedArr: t('12:05'), passengers: 156 },
    { id: 'DS-104', origin: 'HYD', dest: 'BLR', aircraftId: 'VT-DSA', crewId: 'CR-01', schedDep: t('12:50'), schedArr: t('14:00'), passengers: 162 },
    { id: 'DS-105', origin: 'BLR', dest: 'CCU', aircraftId: 'VT-DSA', crewId: 'CR-01', schedDep: t('14:45'), schedArr: t('17:15'), passengers: 168 },

    // === AIRCRAFT 2: VT-DSB (5 legs) — Includes BOM<->AMD shuttle loop ===
    { id: 'DS-201', origin: 'BLR', dest: 'BOM', aircraftId: 'VT-DSB', crewId: 'CR-02', schedDep: t('05:55'), schedArr: t('07:35'), passengers: 194 },
    { id: 'DS-202', origin: 'BOM', dest: 'AMD', aircraftId: 'VT-DSB', crewId: 'CR-02', schedDep: t('08:20'), schedArr: t('09:30'), passengers: 112 },
    { id: 'DS-203', origin: 'AMD', dest: 'BOM', aircraftId: 'VT-DSB', crewId: 'CR-02', schedDep: t('10:15'), schedArr: t('11:25'), passengers: 118 },
    { id: 'DS-204', origin: 'BOM', dest: 'DEL', aircraftId: 'VT-DSB', crewId: 'CR-02', schedDep: t('12:15'), schedArr: t('14:20'), passengers: 208 },
    { id: 'DS-205', origin: 'DEL', dest: 'LKO', aircraftId: 'VT-DSB', crewId: 'CR-02', schedDep: t('15:20'), schedArr: t('16:35'), passengers: 174 },

    // === AIRCRAFT 3: VT-DSC (5 legs) — Crew handoff at DEL: CR-03 -> CR-10 ===
    { id: 'DS-301', origin: 'HYD', dest: 'BOM', aircraftId: 'VT-DSC', crewId: 'CR-03', schedDep: t('06:10'), schedArr: t('07:35'), passengers: 158 },
    { id: 'DS-302', origin: 'BOM', dest: 'DEL', aircraftId: 'VT-DSC', crewId: 'CR-03', schedDep: t('08:40'), schedArr: t('10:45'), passengers: 176 },
    { id: 'DS-303', origin: 'DEL', dest: 'JAI', aircraftId: 'VT-DSC', crewId: 'CR-10', schedDep: t('11:50'), schedArr: t('12:50'), passengers: 108 },
    { id: 'DS-304', origin: 'JAI', dest: 'DEL', aircraftId: 'VT-DSC', crewId: 'CR-10', schedDep: t('13:35'), schedArr: t('14:35'), passengers: 114 },
    { id: 'DS-305', origin: 'DEL', dest: 'PAT', aircraftId: 'VT-DSC', crewId: 'CR-10', schedDep: t('15:25'), schedArr: t('17:00'), passengers: 162 },

    // === AIRCRAFT 4: VT-DSD (5 legs) — DEL->BLR->COK->BLR->BOM->GOI ===
    { id: 'DS-401', origin: 'DEL', dest: 'BLR', aircraftId: 'VT-DSD', crewId: 'CR-04', schedDep: t('06:35'), schedArr: t('09:20'), passengers: 178 },
    { id: 'DS-402', origin: 'BLR', dest: 'COK', aircraftId: 'VT-DSD', crewId: 'CR-04', schedDep: t('10:05'), schedArr: t('11:15'), passengers: 124 },
    { id: 'DS-403', origin: 'COK', dest: 'BLR', aircraftId: 'VT-DSD', crewId: 'CR-04', schedDep: t('12:00'), schedArr: t('13:10'), passengers: 130 },
    { id: 'DS-404', origin: 'BLR', dest: 'BOM', aircraftId: 'VT-DSD', crewId: 'CR-04', schedDep: t('13:55'), schedArr: t('15:40'), passengers: 175 },
    { id: 'DS-405', origin: 'BOM', dest: 'GOI', aircraftId: 'VT-DSD', crewId: 'CR-04', schedDep: t('16:25'), schedArr: t('17:35'), passengers: 166 },

    // === AIRCRAFT 5: VT-DSE (5 legs) — CCU->DEL->BOM->MAA->BLR->HYD ===
    { id: 'DS-501', origin: 'CCU', dest: 'DEL', aircraftId: 'VT-DSE', crewId: 'CR-05', schedDep: t('06:00'), schedArr: t('08:15'), passengers: 196 },
    { id: 'DS-502', origin: 'DEL', dest: 'BOM', aircraftId: 'VT-DSE', crewId: 'CR-05', schedDep: t('09:05'), schedArr: t('11:10'), passengers: 212 },
    { id: 'DS-503', origin: 'BOM', dest: 'MAA', aircraftId: 'VT-DSE', crewId: 'CR-05', schedDep: t('11:55'), schedArr: t('13:50'), passengers: 188 },
    { id: 'DS-504', origin: 'MAA', dest: 'BLR', aircraftId: 'VT-DSE', crewId: 'CR-05', schedDep: t('14:35'), schedArr: t('15:35'), passengers: 168 },
    { id: 'DS-505', origin: 'BLR', dest: 'HYD', aircraftId: 'VT-DSE', crewId: 'CR-05', schedDep: t('16:25'), schedArr: t('17:35'), passengers: 182 },

    // === AIRCRAFT 6: VT-DSF (5 legs) — MAA->HYD->DEL->IXC->DEL->CCU ===
    { id: 'DS-601', origin: 'MAA', dest: 'HYD', aircraftId: 'VT-DSF', crewId: 'CR-06', schedDep: t('06:15'), schedArr: t('07:30'), passengers: 148 },
    { id: 'DS-602', origin: 'HYD', dest: 'DEL', aircraftId: 'VT-DSF', crewId: 'CR-06', schedDep: t('08:15'), schedArr: t('10:25'), passengers: 168 },
    { id: 'DS-603', origin: 'DEL', dest: 'IXC', aircraftId: 'VT-DSF', crewId: 'CR-06', schedDep: t('11:10'), schedArr: t('12:05'), passengers: 104 },
    { id: 'DS-604', origin: 'IXC', dest: 'DEL', aircraftId: 'VT-DSF', crewId: 'CR-06', schedDep: t('12:50'), schedArr: t('13:45'), passengers: 112 },
    { id: 'DS-605', origin: 'DEL', dest: 'CCU', aircraftId: 'VT-DSF', crewId: 'CR-06', schedDep: t('14:40'), schedArr: t('16:50'), passengers: 170 },

    // === AIRCRAFT 7: VT-DSG (4 legs) — BOM->GOI->BOM->HYD->CCU ===
    { id: 'DS-701', origin: 'BOM', dest: 'GOI', aircraftId: 'VT-DSG', crewId: 'CR-07', schedDep: t('08:15'), schedArr: t('09:25'), passengers: 132 },
    { id: 'DS-702', origin: 'GOI', dest: 'BOM', aircraftId: 'VT-DSG', crewId: 'CR-07', schedDep: t('10:10'), schedArr: t('11:20'), passengers: 138 },
    { id: 'DS-703', origin: 'BOM', dest: 'HYD', aircraftId: 'VT-DSG', crewId: 'CR-07', schedDep: t('12:15'), schedArr: t('13:40'), passengers: 166 },
    { id: 'DS-704', origin: 'HYD', dest: 'CCU', aircraftId: 'VT-DSG', crewId: 'CR-07', schedDep: t('14:30'), schedArr: t('16:35'), passengers: 162 },

    // === AIRCRAFT 8: VT-DSH (4 legs) — DEL->GAU->CCU->BBI->DEL ===
    { id: 'DS-801', origin: 'DEL', dest: 'GAU', aircraftId: 'VT-DSH', crewId: 'CR-08', schedDep: t('07:10'), schedArr: t('09:40'), passengers: 164 },
    { id: 'DS-802', origin: 'GAU', dest: 'CCU', aircraftId: 'VT-DSH', crewId: 'CR-08', schedDep: t('10:25'), schedArr: t('11:45'), passengers: 146 },
    { id: 'DS-803', origin: 'CCU', dest: 'BBI', aircraftId: 'VT-DSH', crewId: 'CR-08', schedDep: t('12:35'), schedArr: t('13:40'), passengers: 128 },
    { id: 'DS-804', origin: 'BBI', dest: 'DEL', aircraftId: 'VT-DSH', crewId: 'CR-08', schedDep: t('14:30'), schedArr: t('16:45'), passengers: 172 },

    // === AIRCRAFT 9: VT-DSI (4 legs) — BLR->MAA->CCU->GAU->BLR ===
    { id: 'DS-901', origin: 'BLR', dest: 'MAA', aircraftId: 'VT-DSI', crewId: 'CR-09', schedDep: t('07:30'), schedArr: t('08:30'), passengers: 152 },
    { id: 'DS-902', origin: 'MAA', dest: 'CCU', aircraftId: 'VT-DSI', crewId: 'CR-09', schedDep: t('09:15'), schedArr: t('11:35'), passengers: 164 },
    { id: 'DS-903', origin: 'CCU', dest: 'GAU', aircraftId: 'VT-DSI', crewId: 'CR-09', schedDep: t('12:25'), schedArr: t('13:45'), passengers: 140 },
    { id: 'DS-904', origin: 'GAU', dest: 'BLR', aircraftId: 'VT-DSI', crewId: 'CR-09', schedDep: t('14:40'), schedArr: t('17:45'), passengers: 168 },

    // === AIRCRAFT 10: VT-DSJ (4 legs) — Crew handoff at DEL: CR-10 -> CR-03 (creates cross-aircraft crew cascade!) ===
    { id: 'DS-1001', origin: 'HYD', dest: 'PNQ', aircraftId: 'VT-DSJ', crewId: 'CR-10', schedDep: t('07:00'), schedArr: t('08:15'), passengers: 144 },
    { id: 'DS-1002', origin: 'PNQ', dest: 'DEL', aircraftId: 'VT-DSJ', crewId: 'CR-10', schedDep: t('09:00'), schedArr: t('11:05'), passengers: 168 },
    { id: 'DS-1003', origin: 'DEL', dest: 'BOM', aircraftId: 'VT-DSJ', crewId: 'CR-03', schedDep: t('11:45'), schedArr: t('13:50'), passengers: 174 },
    { id: 'DS-1004', origin: 'BOM', dest: 'COK', aircraftId: 'VT-DSJ', crewId: 'CR-03', schedDep: t('14:45'), schedArr: t('16:45'), passengers: 160 },

    // === AIRCRAFT 11: VT-DSK (4 legs) — AMD->DEL->HYD->MAA->BOM ===
    { id: 'DS-1101', origin: 'AMD', dest: 'DEL', aircraftId: 'VT-DSK', crewId: 'CR-11', schedDep: t('07:20'), schedArr: t('08:55'), passengers: 192 },
    { id: 'DS-1102', origin: 'DEL', dest: 'HYD', aircraftId: 'VT-DSK', crewId: 'CR-11', schedDep: t('09:50'), schedArr: t('12:05'), passengers: 204 },
    { id: 'DS-1103', origin: 'HYD', dest: 'MAA', aircraftId: 'VT-DSK', crewId: 'CR-11', schedDep: t('12:55'), schedArr: t('14:10'), passengers: 186 },
    { id: 'DS-1104', origin: 'MAA', dest: 'BOM', aircraftId: 'VT-DSK', crewId: 'CR-11', schedDep: t('15:05'), schedArr: t('17:00'), passengers: 202 },

    // === AIRCRAFT 12: VT-DSL (4 legs) — CCU->PAT->DEL->BLR->PNQ ===
    { id: 'DS-1201', origin: 'CCU', dest: 'PAT', aircraftId: 'VT-DSL', crewId: 'CR-12', schedDep: t('07:45'), schedArr: t('08:55'), passengers: 136 },
    { id: 'DS-1202', origin: 'PAT', dest: 'DEL', aircraftId: 'VT-DSL', crewId: 'CR-12', schedDep: t('09:40'), schedArr: t('11:20'), passengers: 162 },
    { id: 'DS-1203', origin: 'DEL', dest: 'BLR', aircraftId: 'VT-DSL', crewId: 'CR-12', schedDep: t('12:15'), schedArr: t('15:00'), passengers: 178 },
    { id: 'DS-1204', origin: 'BLR', dest: 'PNQ', aircraftId: 'VT-DSL', crewId: 'CR-12', schedDep: t('15:50'), schedArr: t('17:20'), passengers: 158 },

    // === AIRCRAFT 13: VT-DSM (4 legs) — PNQ->BLR->DEL->BOM->JAI ===
    { id: 'DS-1301', origin: 'PNQ', dest: 'BLR', aircraftId: 'VT-DSM', crewId: 'CR-13', schedDep: t('08:15'), schedArr: t('09:45'), passengers: 150 },
    { id: 'DS-1302', origin: 'BLR', dest: 'DEL', aircraftId: 'VT-DSM', crewId: 'CR-13', schedDep: t('11:05'), schedArr: t('13:50'), passengers: 172 },
    { id: 'DS-1303', origin: 'DEL', dest: 'BOM', aircraftId: 'VT-DSM', crewId: 'CR-13', schedDep: t('14:40'), schedArr: t('16:45'), passengers: 176 },
    { id: 'DS-1304', origin: 'BOM', dest: 'JAI', aircraftId: 'VT-DSM', crewId: 'CR-13', schedDep: t('17:35'), schedArr: t('19:20'), passengers: 154 },

    // === AIRCRAFT 14: VT-DSN (4 legs) — COK->BOM->CCU->HYD->BBI ===
    { id: 'DS-1401', origin: 'COK', dest: 'BOM', aircraftId: 'VT-DSN', crewId: 'CR-14', schedDep: t('06:30'), schedArr: t('08:25'), passengers: 154 },
    { id: 'DS-1402', origin: 'BOM', dest: 'CCU', aircraftId: 'VT-DSN', crewId: 'CR-14', schedDep: t('09:15'), schedArr: t('11:50'), passengers: 170 },
    { id: 'DS-1403', origin: 'CCU', dest: 'HYD', aircraftId: 'VT-DSN', crewId: 'CR-14', schedDep: t('12:40'), schedArr: t('14:50'), passengers: 162 },
    { id: 'DS-1404', origin: 'HYD', dest: 'BBI', aircraftId: 'VT-DSN', crewId: 'CR-14', schedDep: t('15:40'), schedArr: t('17:10'), passengers: 144 },

    // === AIRCRAFT 15: VT-DSO (4 legs) — LKO->BOM->PNQ->HYD->BLR ===
    { id: 'DS-1501', origin: 'LKO', dest: 'BOM', aircraftId: 'VT-DSO', crewId: 'CR-15', schedDep: t('06:40'), schedArr: t('08:45'), passengers: 160 },
    { id: 'DS-1502', origin: 'BOM', dest: 'PNQ', aircraftId: 'VT-DSO', crewId: 'CR-15', schedDep: t('09:35'), schedArr: t('10:25'), passengers: 126 },
    { id: 'DS-1503', origin: 'PNQ', dest: 'HYD', aircraftId: 'VT-DSO', crewId: 'CR-15', schedDep: t('11:15'), schedArr: t('12:30'), passengers: 148 },
    { id: 'DS-1504', origin: 'HYD', dest: 'BLR', aircraftId: 'VT-DSO', crewId: 'CR-15', schedDep: t('13:20'), schedArr: t('14:30'), passengers: 166 },

    // === AIRCRAFT 16: VT-DSP (4 legs) — IXC->BOM->HYD->GOI->DEL ===
    { id: 'DS-1601', origin: 'IXC', dest: 'BOM', aircraftId: 'VT-DSP', crewId: 'CR-16', schedDep: t('06:25'), schedArr: t('08:50'), passengers: 158 },
    { id: 'DS-1602', origin: 'BOM', dest: 'HYD', aircraftId: 'VT-DSP', crewId: 'CR-16', schedDep: t('09:40'), schedArr: t('11:05'), passengers: 164 },
    { id: 'DS-1603', origin: 'HYD', dest: 'GOI', aircraftId: 'VT-DSP', crewId: 'CR-16', schedDep: t('11:55'), schedArr: t('13:15'), passengers: 142 },
    { id: 'DS-1604', origin: 'GOI', dest: 'DEL', aircraftId: 'VT-DSP', crewId: 'CR-16', schedDep: t('14:10'), schedArr: t('16:40'), passengers: 170 },
  ],

  connections: [
    // BOM Hub Connections
    { id: 'CX-01', fromFlightId: 'DS-101', toFlightId: 'DS-302', airportCode: 'BOM', passengers: 18, mctMinutes: 45 },
    { id: 'CX-02', fromFlightId: 'DS-201', toFlightId: 'DS-302', airportCode: 'BOM', passengers: 26, mctMinutes: 45 },
    { id: 'CX-03', fromFlightId: 'DS-301', toFlightId: 'DS-102', airportCode: 'BOM', passengers: 22, mctMinutes: 45 },
    { id: 'CX-04', fromFlightId: 'DS-1401', toFlightId: 'DS-1502', airportCode: 'BOM', passengers: 16, mctMinutes: 45 },
    { id: 'CX-05', fromFlightId: 'DS-1501', toFlightId: 'DS-1602', airportCode: 'BOM', passengers: 20, mctMinutes: 45 },
    { id: 'CX-06', fromFlightId: 'DS-502', toFlightId: 'DS-204', airportCode: 'BOM', passengers: 28, mctMinutes: 45 },
    { id: 'CX-07', fromFlightId: 'DS-702', toFlightId: 'DS-204', airportCode: 'BOM', passengers: 24, mctMinutes: 45 },
    { id: 'CX-08', fromFlightId: 'DS-203', toFlightId: 'DS-703', airportCode: 'BOM', passengers: 19, mctMinutes: 45 },
    { id: 'CX-09', fromFlightId: 'DS-1003', toFlightId: 'DS-1004', airportCode: 'BOM', passengers: 18, mctMinutes: 45 },
    { id: 'CX-10', fromFlightId: 'DS-404', toFlightId: 'DS-1304', airportCode: 'BOM', passengers: 21, mctMinutes: 45 },

    // BLR Hub Connections
    { id: 'CX-11', fromFlightId: 'DS-102', toFlightId: 'DS-1302', airportCode: 'BLR', passengers: 32, mctMinutes: 45 },
    { id: 'CX-12', fromFlightId: 'DS-401', toFlightId: 'DS-103', airportCode: 'BLR', passengers: 24, mctMinutes: 45 },
    { id: 'CX-13', fromFlightId: 'DS-1301', toFlightId: 'DS-103', airportCode: 'BLR', passengers: 19, mctMinutes: 45 },
    { id: 'CX-14', fromFlightId: 'DS-403', toFlightId: 'DS-105', airportCode: 'BLR', passengers: 28, mctMinutes: 45 },
    { id: 'CX-15', fromFlightId: 'DS-104', toFlightId: 'DS-1204', airportCode: 'BLR', passengers: 22, mctMinutes: 45 },
    { id: 'CX-16', fromFlightId: 'DS-1504', toFlightId: 'DS-1204', airportCode: 'BLR', passengers: 17, mctMinutes: 45 },
    { id: 'CX-17', fromFlightId: 'DS-1203', toFlightId: 'DS-505', airportCode: 'BLR', passengers: 25, mctMinutes: 45 },
    { id: 'CX-18', fromFlightId: 'DS-504', toFlightId: 'DS-505', airportCode: 'BLR', passengers: 14, mctMinutes: 45 },

    // DEL Hub Connections
    { id: 'CX-19', fromFlightId: 'DS-501', toFlightId: 'DS-1102', airportCode: 'DEL', passengers: 30, mctMinutes: 45 },
    { id: 'CX-20', fromFlightId: 'DS-1101', toFlightId: 'DS-1102', airportCode: 'DEL', passengers: 21, mctMinutes: 45 },
    { id: 'CX-21', fromFlightId: 'DS-602', toFlightId: 'DS-303', airportCode: 'DEL', passengers: 18, mctMinutes: 45 },
    { id: 'CX-22', fromFlightId: 'DS-302', toFlightId: 'DS-1003', airportCode: 'DEL', passengers: 29, mctMinutes: 45 },
    { id: 'CX-23', fromFlightId: 'DS-302', toFlightId: 'DS-1203', airportCode: 'DEL', passengers: 26, mctMinutes: 45 },
    { id: 'CX-24', fromFlightId: 'DS-1002', toFlightId: 'DS-1203', airportCode: 'DEL', passengers: 22, mctMinutes: 45 },
    { id: 'CX-25', fromFlightId: 'DS-1202', toFlightId: 'DS-1203', airportCode: 'DEL', passengers: 16, mctMinutes: 45 },
    { id: 'CX-26', fromFlightId: 'DS-1302', toFlightId: 'DS-1303', airportCode: 'DEL', passengers: 24, mctMinutes: 45 },
    { id: 'CX-27', fromFlightId: 'DS-604', toFlightId: 'DS-605', airportCode: 'DEL', passengers: 20, mctMinutes: 45 },
    { id: 'CX-28', fromFlightId: 'DS-304', toFlightId: 'DS-205', airportCode: 'DEL', passengers: 19, mctMinutes: 45 },
    { id: 'CX-29', fromFlightId: 'DS-204', toFlightId: 'DS-305', airportCode: 'DEL', passengers: 25, mctMinutes: 45 },

    // HYD Hub Connections
    { id: 'CX-30', fromFlightId: 'DS-601', toFlightId: 'DS-602', airportCode: 'HYD', passengers: 15, mctMinutes: 45 },
    { id: 'CX-31', fromFlightId: 'DS-1602', toFlightId: 'DS-1603', airportCode: 'HYD', passengers: 18, mctMinutes: 45 },
    { id: 'CX-32', fromFlightId: 'DS-103', toFlightId: 'DS-1103', airportCode: 'HYD', passengers: 23, mctMinutes: 45 },
    { id: 'CX-33', fromFlightId: 'DS-1102', toFlightId: 'DS-1103', airportCode: 'HYD', passengers: 19, mctMinutes: 45 },
    { id: 'CX-34', fromFlightId: 'DS-1503', toFlightId: 'DS-1504', airportCode: 'HYD', passengers: 21, mctMinutes: 45 },
    { id: 'CX-35', fromFlightId: 'DS-703', toFlightId: 'DS-704', airportCode: 'HYD', passengers: 22, mctMinutes: 45 },
    { id: 'CX-36', fromFlightId: 'DS-1403', toFlightId: 'DS-1404', airportCode: 'HYD', passengers: 17, mctMinutes: 45 },

    // CCU & MAA Regional Hub Connections
    { id: 'CX-37', fromFlightId: 'DS-902', toFlightId: 'DS-903', airportCode: 'CCU', passengers: 20, mctMinutes: 45 },
    { id: 'CX-38', fromFlightId: 'DS-802', toFlightId: 'DS-1403', airportCode: 'CCU', passengers: 18, mctMinutes: 45 },
    { id: 'CX-39', fromFlightId: 'DS-1402', toFlightId: 'DS-1403', airportCode: 'CCU', passengers: 24, mctMinutes: 45 },
    { id: 'CX-40', fromFlightId: 'DS-503', toFlightId: 'DS-1104', airportCode: 'MAA', passengers: 26, mctMinutes: 45 },
  ],

  spares: [
    { id: 'VT-SP1', model: 'A320neo', capacity: 186, baseAirport: 'BOM', readyFrom: t('08:00'), includesFreshCrew: true, operatingCostInrLakhs: 14.5 },
    { id: 'VT-SP2', model: 'A321neo', capacity: 220, baseAirport: 'DEL', readyFrom: t('08:00'), includesFreshCrew: true, operatingCostInrLakhs: 16.0 },
    { id: 'VT-SP3', model: 'A320neo', capacity: 180, baseAirport: 'BLR', readyFrom: t('09:30'), includesFreshCrew: true, operatingCostInrLakhs: 13.5 },
    { id: 'VT-SP4', model: 'B737-8', capacity: 186, baseAirport: 'HYD', readyFrom: t('10:00'), includesFreshCrew: true, operatingCostInrLakhs: 13.0 },
  ],

  standbyCrews: [
    { id: 'SB-BOM', name: 'Reserve Crew Alpha (BOM)', baseAirport: 'BOM', readyFrom: t('08:00'), maxDutyMinutes: 660 },
    { id: 'SB-DEL', name: 'Reserve Crew Bravo (DEL)', baseAirport: 'DEL', readyFrom: t('08:00'), maxDutyMinutes: 660 },
    { id: 'SB-BLR', name: 'Reserve Crew Charlie (BLR)', baseAirport: 'BLR', readyFrom: t('09:30'), maxDutyMinutes: 660 },
    { id: 'SB-HYD', name: 'Reserve Crew Delta (HYD)', baseAirport: 'HYD', readyFrom: t('10:00'), maxDutyMinutes: 660 },
  ],
};

// Fix CR-06 maxDutyMinutes check: DS-601 dep 06:15 (report 05:30) to DS-605 arr 16:50 (debrief 17:05) = 695m.
// Let's make sure CR-06 has maxDutyMinutes = 735 (gives 40m legal margin before FDTL breach).
DEFAULT_DATASET.crews = DEFAULT_DATASET.crews.map((c) =>
  c.id === 'CR-06' ? { ...c, maxDutyMinutes: 735 } : c
);

export interface PresetScenario {
  id: string;
  label: string;
  description: string;
  disruption: {
    airportCode: string;
    startMin: number;
    endMin: number;
    reason: 'Thunderstorm' | 'Dense Fog' | 'Runway Closure' | 'ATC Ground Stop';
  };
  secondaryDisruption?: {
    airportCode: string;
    startMin: number;
    endMin: number;
    reason: 'Thunderstorm' | 'Dense Fog' | 'Runway Closure' | 'ATC Ground Stop';
  } | null;
}

export const PRESET_SCENARIOS: PresetScenario[] = [
  {
    id: 'bom-storm',
    label: 'Mumbai Monsoon Cell',
    description: '08:00–09:30 thunderstorm at BOM triggers BLR→CCU cancellation 5 hours later',
    disruption: {
      airportCode: 'BOM',
      startMin: parseTime('08:00'),
      endMin: parseTime('09:30'),
      reason: 'Thunderstorm',
    },
    secondaryDisruption: null,
  },
  {
    id: 'del-fog',
    label: 'Delhi Winter Fog',
    description: '06:30–08:30 low-visibility ground stop at DEL cascades across North & East India',
    disruption: {
      airportCode: 'DEL',
      startMin: parseTime('06:30'),
      endMin: parseTime('08:30'),
      reason: 'Dense Fog',
    },
    secondaryDisruption: null,
  },
  {
    id: 'blr-closure',
    label: 'Bengaluru Peak Bank Squeeze',
    description: '10:00–12:00 ATC ground stop at BLR breaks South India connecting bank',
    disruption: {
      airportCode: 'BLR',
      startMin: parseTime('10:00'),
      endMin: parseTime('12:00'),
      reason: 'ATC Ground Stop',
    },
    secondaryDisruption: null,
  },
  {
    id: 'rolling-bom-del',
    label: 'Rolling: BOM → DEL',
    description: '08:00–09:30 BOM monsoon storm followed by 13:30–15:00 DEL ATC ground stop',
    disruption: {
      airportCode: 'BOM',
      startMin: parseTime('08:00'),
      endMin: parseTime('09:30'),
      reason: 'Thunderstorm',
    },
    secondaryDisruption: {
      airportCode: 'DEL',
      startMin: parseTime('13:30'),
      endMin: parseTime('15:00'),
      reason: 'ATC Ground Stop',
    },
  },
];
