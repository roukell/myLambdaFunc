// This lambda function is invoked by SNS Topic in the beginning of ASG lifecycle hook (Terminate EC2). 
// It deletes a total of 23 customised CloudWatch alarms.
const AWS = require("aws-sdk");
const as = new AWS.AutoScaling();
const cw = new AWS.CloudWatch();

const memoryAlarmList = [
  "agentstatus",
  "cod",
  "loggerhead",
  "manta",
  "nautilus",
  "oyster",
  "piranha",
  "reef",
  "sponge",
  "urchin",
  "iceflow",
];
const diskAlarmList = [
  "systemLevelDiskUsedPercentHighPriority",
  "varDiskUsedPercentHighPriority",
  "optDiskUsedPercentHighPriority",
  "systemLevelDiskUsedPercentMediumPriority",
  "varDiskUsedPercentMediumPriority",
  "optDiskUsedPercentMediumPriority",
  "systemLevelDiskLowAvaliableSpaceHighPriority",
  "varDiskLowAvaliableSpaceHighPriority",
  "optDiskLowAvaliableSpaceHighPriority",
  "systemLevelDiskLowAvaliableSpaceMediumPriority",
  "varDiskLowAvaliableSpaceMediumPriority",
  "optDiskLowAvaliableSpaceMediumPriority",
];

exports.lambdaHandler = async (notification, context) => {
  let result = "ABANDON";
  let lifecycleParams;
  let alarmNamesArray = [];
  // Log the request
  console.log("INFO: request Recieved. Details: ", JSON.stringify(notification));
  const message = JSON.parse(notification.Records[0].Sns.Message);
  const instanceId = message.EC2InstanceId;

  //define a closure for easy termination later on
  const terminate = function (success, err) {
    lifecycleParams = {
      "AutoScalingGroupName" : message.AutoScalingGroupName,
      "LifecycleHookName" : message.LifecycleHookName,
      "LifecycleActionToken" : message.LifecycleActionToken,
      "LifecycleActionResult" : result
    };
    //log that we're terminating and why
    if(!success){
      console.log("ERROR: Lambda function reporting failure to AutoScaling with error: ", err);
      as.completeLifecycleAction(lifecycleParams);
      return;
    } else {
      as.completeLifecycleAction(lifecycleParams);
      console.log("INFO: CompleteLifecycleAction Successful.");
    }
  }; 

  for (let i of memoryAlarmList) {
    const alarmName = `${i}-memory-alarm-${instanceId}`;
    alarmNamesArray.push(alarmName);
  }

  for (let j of diskAlarmList) {
    const alarmName = `${j}-disk-alarm-${instanceId}`
    alarmNamesArray.push(alarmName);
  }

  // also need to push system level CPU alarm in alarmNamesArray
  alarmNamesArray.push(`systemLevelMediumPriority-cpu-alarm-${instanceId}`);

  console.log("INFO: list of alarms to be deleted: ", alarmNamesArray);

  //delete all alarms
  const params = { "AlarmNames": alarmNamesArray };

  try {
    await cw.deleteAlarms(params).promise();
    console.log("INFO: deleted all alarms");
    result = "CONTINUE";
    terminate(true);
  } catch (err) {
    console.log("ERROR: Failed to delete alarms: ", err);
    terminate(false, err);
  }
};
