import assert from 'node:assert/strict';
import { savedPlanEaters, isAttendanceControlled, previewMealEaters, mealAttendanceLabel } from './planServingLogic.js';

const cases = [
  [savedPlanEaters({saved_eaters:4,eaters:0},2),4,'zero live attendance retains saved backup'],
  [savedPlanEaters({saved_eaters:2,eaters:4},4),2,'saved backup wins over effective'],
  [savedPlanEaters({eaters:3},4),3,'old APIs still work'],
  [savedPlanEaters(null,4),4,'new plan uses household default'],
  [savedPlanEaters({saved_eaters:0},4),4,'invalid saved count uses default'],
  [savedPlanEaters({saved_eaters:999},4),4,'invalid large count uses default'],
  [previewMealEaters(4,{attendance_enabled:false,roster_eaters:1}),4,'tracking-only uses stored count'],
  [previewMealEaters(4,{attendance_enabled:true,roster_eaters:2}),2,'live attendance scales recipe'],
  [previewMealEaters(4,{attendance_enabled:true,roster_eaters:0}),0,'empty attendance has zero requirements'],
  [previewMealEaters(4,{attendance_enabled:true,roster_eaters:31}),null,'invalid attendance not displayed as safe value'],
  [previewMealEaters(5,null),5,'missing attendance response uses saved count for pure calculation'],
  [isAttendanceControlled({attendance_enabled:true}),true,'opt-in detected'],
  [isAttendanceControlled({attendance_enabled:false}),false,'opt-out detected'],
  [mealAttendanceLabel(0),'No one attending','zero attendance label'],
  [mealAttendanceLabel(1),'1 person attending','singular grammar'],
  [mealAttendanceLabel(3),'3 people attending','plural grammar'],
];
for (const [received,expected,label] of cases) assert.equal(received,expected,label);
console.log(`${cases.length} plan serving assertions passed`);
