// This lambda function is invoked by SNS Topic in the beginning of ASG lifecycle hook. 
// It creates a total of 23 customised CloudWatch alarms.
let response;
const AWS = require("aws-sdk");
const as = new AWS.AutoScaling();
const cw = new AWS.CloudWatch();
const ssm = new AWS.SSM();

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
  // Log the request
  console.log("INFO: request Recieved. Details: ", JSON.stringify(notification));
  const message = JSON.parse(notification.Records[0].Sns.Message);
  const metadata = message.NotificationMetadata;
  console.log("DEBUG: SNS message contents. Message: ", message);
  console.log("DEBUG: Extracted Message Data. Data: ", metadata);

  // Pull out metadata
  const instanceId = message.EC2InstanceId;
  const params1 = { Name: `${metadata}-MediumPriorityAlarmTopicArn` };
  const params2 = { Name: `${metadata}-HighPriorityAlarmTopicArn` };
  const params3 = { Name: `${metadata}-CoralASGName` };

  let SNSMediumPriorityTopicArn;
  let SNSHighPriorityTopicArn;
  let AutoScalingGroupName;

  const request1 = await ssm.getParameter(params1).promise();
  SNSMediumPriorityTopicArn = request1.Parameter.Value;
  console.log(SNSMediumPriorityTopicArn);
  
  const request2 = await ssm.getParameter(params2).promise();
  SNSHighPriorityTopicArn = request2.Parameter.Value;
  console.log(SNSHighPriorityTopicArn);
  
  const request3 = await ssm.getParameter(params3).promise();
  AutoScalingGroupName = request3.Parameter.Value;
  console.log(AutoScalingGroupName);

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
    }
  }; 

  // loop through the memory alarms list and create memory alarms
  for (let i of memoryAlarmList) {
    let process_name = i;
    let threshold = 1073741824;
    if (i === "sponge") process_name = "java";
    if (i === "reef") threshold = 4294967296;

    const alarmParams = {
      AlarmName: `${process_name}-memory-alarm-${instanceId}`,
      AlarmActions: [SNSMediumPriorityTopicArn],
      AlarmDescription: `${instanceId} - high resident set memory usage (bytes) - ${i}`,
      MetricName: "procstat_memory_rss",
      Namespace: "CWAgent",
      Dimensions: [
        {
          Name: "AutoScalingGroupName",
          Value: AutoScalingGroupName,
        },
        {
          Name: "InstanceId",
          Value: instanceId,
        },
        {
          Name: "pidfile",
          Value: `/opt/coral/pids/${i}.pid`,
        },
        {
          Name: "process_name",
          Value: process_name,
        },
      ],
      Period: 300,
      EvaluationPeriods: 3,
      Statistic: "Average",
      Threshold: threshold,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      ActionsEnabled: true,
    };

    console.log("DEBUG: Creating Memory Alarm: ", alarmParams);
    try {
      await cw.putMetricAlarm(alarmParams).promise();
    } catch (err) {
      console.log("ERROR: Failed to create memory alarm: ", err);
      terminate(false, err);
    }
  }

  // loop through the disk alarms list and create disk alarms
  for (let j of diskAlarmList) {
    // set default for systemLevelDiskUsedPercentMediumPriorityAlarm
    let alarmActions = SNSMediumPriorityTopicArn;
    let metricName = "Partition disk usage %";
    let threshold = 80;
    let comparisonOperator = "GreaterThanOrEqualToThreshold";
    let path = "/";
    let device = "nvme0n1p1";
    let alarmDescription = `${instanceId} - high disk usage 80% in ${path}`;
    const fstype = "xfs";

    if (j.includes("var")) {
      path = "/var";
      device = "nvme1n1p1";
    } else if (j.includes("opt")) {
      path = "/opt";
      device = "nvme2n1p1";
    }

    if (j.includes("HighPriority")) alarmActions = SNSHighPriorityTopicArn;

    if (j.includes("DiskLowAvaliableSpace")) {
      metricName = "Partition disk free space";
      comparisonOperator = "LessThanOrEqualToThreshold";
    }

    if (j.includes("DiskUsedPercentHighPriority")) {
      threshold = 90;
      alarmDescription = `${instanceId} - high disk usage 90% in ${path}`;
    }

    if (j.includes("DiskLowAvaliableSpaceHighPriority")) {
      threshold = 2147483648;
      alarmDescription = `${instanceId} - low disk available space < 2GB in ${path}`;
    }

    if (j.includes("DiskLowAvaliableSpaceMediumPriority")) {
      threshold = 5368709120;
      alarmDescription = `${instanceId} - low disk available space < 5GB in ${path}`;
    }

    const alarmParams = {
      AlarmName: `${j}-disk-alarm-${instanceId}`,
      AlarmActions: [alarmActions],
      AlarmDescription: alarmDescription,
      MetricName: metricName,
      Namespace: "CWAgent",
      Dimensions: [
        {
          Name: "AutoScalingGroupName",
          Value: AutoScalingGroupName,
        },
        {
          Name: "InstanceId",
          Value: instanceId,
        },
        {
          Name: "path",
          Value: path,
        },
        {
          Name: "device",
          Value: device,
        },
        {
          Name: "fstype",
          Value: fstype,
        },
      ],
      Period: 300,
      EvaluationPeriods: 3,
      Statistic: "Average",
      Threshold: threshold,
      ComparisonOperator: comparisonOperator,
      ActionsEnabled: true,
    };

    console.log("DEBUG: Creating Disk Alarm: ", alarmParams);
    try {
      await cw.putMetricAlarm(alarmParams).promise();
    } catch (err) {
      console.log("ERROR: Failed to create disk alarm: ", err);
      terminate(false, err);
    }
  }

  // create system level CPU alarm
  const alarmParamsCpu = {
    AlarmName: `systemLevelMediumPriority-cpu-alarm-${instanceId}`,
    AlarmActions: [SNSMediumPriorityTopicArn],
    AlarmDescription: `${instanceId} - high CPU usage 90% at system level`,
    MetricName: "CPUUtilization",
    Namespace: "AWS/EC2",
    Dimensions: [
      {
        Name: "InstanceId",
        Value: instanceId,
      }
    ],
    Period: 300,
    EvaluationPeriods: 3,
    Statistic: "Average",
    Threshold: 90,
    ComparisonOperator: "GreaterThanOrEqualToThreshold",
    ActionsEnabled: true,
  };

  console.log("DEBUG: Creating system level CPU Alarm: ", alarmParamsCpu);
  try {
    await cw.putMetricAlarm(alarmParamsCpu).promise();
  } catch (err) {
    console.log("ERROR: Failed to create system level CPU alarm: ", err);
    terminate(false, err);
  }

  result = "CONTINUE";
  as.completeLifecycleAction(lifecycleParams);
  console.log("INFO: CompleteLifecycleAction Successful.");
};
