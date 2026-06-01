const tasks = [
  {
    id: "T-CDSY-MEM-UAT",
    hospitalId: "demoa",
    accountId: "demo_uat",
    applicationCode: "mem",
    category: "mem",
    environmentId: "demoa-uat-a",
    targetBranch: "mastertest",
    state: "release_ready",
    risk: ["同账号双平台", "测试发布"],
    title: "演示客户A / demo_uat / mem / mastertest/a",
    currentAction: "刷新发布记录并确认发布门禁",
    lastKnownVersion: "1.8.83",
    nextGate: "发布前确认门",
    timeline: [
      "账号已验证可登录构建平台与发布平台",
      "发布平台已定位到现场测试环境A",
      "MVP 阶段只允许强确认执行，不自动发布"
    ]
  },
  {
    id: "T-CDSY-EMR-PROD",
    hospitalId: "demoa",
    accountId: "demo_uat",
    applicationCode: "emr",
    category: "emr",
    environmentId: "demoa-prod-a",
    targetBranch: "master",
    state: "release_pending_confirm",
    risk: ["正式环境", "同账号双平台"],
    title: "演示客户A / demo_uat / emr / master/a",
    currentAction: "锁定生产发布确认",
    lastKnownVersion: "1.7.25",
    nextGate: "生产环境二次确认",
    timeline: [
      "发布平台已定位到生产环境A",
      "生产发布必须人工确认医院、账号、应用、环境、版本"
    ]
  },
  {
    id: "T-GAM-EMR-UAT",
    hospitalId: "demob",
    accountId: "demo_prod",
    applicationCode: "emr",
    category: "emr",
    environmentId: "demob-uat-a",
    targetBranch: "uat-demo-b",
    state: "release_ready",
    risk: ["测试发布", "同账号双平台"],
    title: "演示客户B / demo_prod / emr / uat-demo-b/a",
    currentAction: "刷新构建与发布范围",
    lastKnownVersion: "1.3.89",
    nextGate: "发布前确认门",
    timeline: [
      "账号已验证可登录发布平台",
      "发布平台已定位到 uat-demo-bA",
      "MVP 阶段只允许强确认执行，不自动发布"
    ]
  },
  {
    id: "T-GAM-MEM-PROD",
    hospitalId: "demob",
    accountId: "demo_prod",
    applicationCode: "mem",
    category: "mem",
    environmentId: "demob-prod-a",
    targetBranch: "prod-demo-b",
    state: "release_pending_confirm",
    risk: ["正式环境", "同账号双平台"],
    title: "演示客户B / demo_prod / mem / prod-demo-b/a",
    currentAction: "锁定生产发布确认",
    lastKnownVersion: "1.1.64",
    nextGate: "生产环境二次确认",
    timeline: [
      "发布平台已定位到 prod-demo-bA",
      "生产发布必须人工确认医院、账号、应用、环境、版本"
    ]
  }
];

const stateLabels = {
  account_needed: "账号待配置",
  draft: "草稿",
  build_pending_confirm: "构建待确认",
  building: "构建中",
  build_success: "构建成功",
  release_ready: "可进入发布探测",
  release_pending_confirm: "发布待确认",
  releasing: "发布中",
  release_success: "发布成功",
  verified: "已验证"
};

module.exports = {
  stateLabels,
  tasks
};
