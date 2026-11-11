package main

// Byte layout of LMU's built-in "LMU_Data" shared memory.
//
// Source: LMU's SharedMemoryInterface.hpp (S397, Support\SharedMemoryInterface),
// as transcribed and verified against LMU 1.4 by github.com/Swizzjack/lmu-pitwall.
// The C++ side uses #pragma pack(4), which Go structs cannot express, so offsets
// are computed here from the field list and the struct sizes are asserted.

import "fmt"

type kind struct{ size, align int }

var (
	tU8   = kind{1, 1}
	tI8   = kind{1, 1}
	tI16  = kind{2, 2}
	tU16  = kind{2, 2}
	tI32  = kind{4, 4}
	tU32  = kind{4, 4}
	tF32  = kind{4, 4}
	tF64  = kind{8, 4} // pack(4) caps alignment at 4
	tU64  = kind{8, 4}
	tVec3 = kind{24, 4}
)

func bytesK(n int) kind      { return kind{n, 1} }
func arr(k kind, n int) kind { return kind{k.size * n, k.align} }

type layout struct {
	name string
	off  map[string]int
	pos  int
	max  int
}

func newLayout(name string) *layout { return &layout{name: name, off: map[string]int{}, max: 1} }

func (l *layout) f(name string, k kind) *layout {
	a := k.align
	if a > 4 {
		a = 4
	}
	if a > l.max {
		l.max = a
	}
	if r := l.pos % a; r != 0 {
		l.pos += a - r
	}
	l.off[name] = l.pos
	l.pos += k.size
	return l
}

func (l *layout) size() int {
	s := l.pos
	if r := s % l.max; r != 0 {
		s += l.max - r
	}
	return s
}

func (l *layout) kind() kind { return kind{l.size(), l.max} }

func (l *layout) o(name string) int {
	v, ok := l.off[name]
	if !ok {
		panic("unknown field " + l.name + "." + name)
	}
	return v
}

var (
	Wheel, VehTelem, VehScoring, ScoringInfo, ObjectOut *layout
	MaxVehicles                                         = 104
)

func init() {
	Wheel = newLayout("rF2Wheel").
		f("mSuspensionDeflection", tF64).f("mRideHeight", tF64).f("mSuspForce", tF64).
		f("mBrakeTemp", tF64).f("mBrakePressure", tF64).f("mRotation", tF64).
		f("mLateralPatchVel", tF64).f("mLongitudinalPatchVel", tF64).
		f("mLateralGroundVel", tF64).f("mLongitudinalGroundVel", tF64).
		f("mCamber", tF64).f("mLateralForce", tF64).f("mLongitudinalForce", tF64).
		f("mTireLoad", tF64).f("mGripFract", tF64).f("mPressure", tF64).
		f("mTemperature", arr(tF64, 3)).f("mWear", tF64).f("mTerrainName", bytesK(16)).
		f("mSurfaceType", tU8).f("mFlat", tU8).f("mDetached", tU8).f("mStaticUndeflectedRadius", tU8).
		f("mVerticalTireDeflection", tF64).f("mWheelYLocation", tF64).f("mToe", tF64).
		f("mTireCarcassTemperature", tF64).f("mTireInnerLayerTemperature", arr(tF64, 3)).
		f("mOptimalTemp", tF32).f("mCompoundIndex", tU8).f("mCompoundType", tU8).
		f("mExpansion", bytesK(18))

	VehTelem = newLayout("rF2VehicleTelemetry").
		f("mID", tI32).f("mDeltaTime", tF64).f("mElapsedTime", tF64).f("mLapNumber", tI32).
		f("mLapStartET", tF64).f("mVehicleName", bytesK(64)).f("mTrackName", bytesK(64)).
		f("mPos", tVec3).f("mLocalVel", tVec3).f("mLocalAccel", tVec3).f("mOri", arr(tVec3, 3)).
		f("mLocalRot", tVec3).f("mLocalRotAccel", tVec3).
		f("mGear", tI32).f("mEngineRPM", tF64).f("mEngineWaterTemp", tF64).f("mEngineOilTemp", tF64).
		f("mClutchRPM", tF64).
		f("mUnfilteredThrottle", tF64).f("mUnfilteredBrake", tF64).f("mUnfilteredSteering", tF64).f("mUnfilteredClutch", tF64).
		f("mFilteredThrottle", tF64).f("mFilteredBrake", tF64).f("mFilteredSteering", tF64).f("mFilteredClutch", tF64).
		f("mSteeringShaftTorque", tF64).f("mFront3rdDeflection", tF64).f("mRear3rdDeflection", tF64).
		f("mFrontWingHeight", tF64).f("mFrontRideHeight", tF64).f("mRearRideHeight", tF64).
		f("mDrag", tF64).f("mFrontDownforce", tF64).f("mRearDownforce", tF64).
		f("mFuel", tF64).f("mEngineMaxRPM", tF64).
		f("mScheduledStops", tU8).f("mOverheating", tU8).f("mDetached", tU8).f("mHeadlights", tU8).
		f("mDentSeverity", bytesK(8)).
		f("mLastImpactET", tF64).f("mLastImpactMagnitude", tF64).f("mLastImpactPos", tVec3).
		f("mEngineTorque", tF64).f("mCurrentSector", tI32).f("mSpeedLimiter", tU8).f("mMaxGears", tU8).
		f("mFrontTireCompoundIndex", tU8).f("mRearTireCompoundIndex", tU8).f("mFuelCapacity", tF64).
		f("mFrontFlapActivated", tU8).f("mRearFlapActivated", tU8).f("mRearFlapLegalStatus", tU8).f("mIgnitionStarter", tU8).
		f("mFrontTireCompoundName", bytesK(18)).f("mRearTireCompoundName", bytesK(18)).
		f("mSpeedLimiterAvailable", tU8).f("mAntiStallActivated", tU8).f("mUnused", bytesK(2)).
		f("mVisualSteeringWheelRange", tF32).f("mRearBrakeBias", tF64).f("mTurboBoostPressure", tF64).
		f("mPhysicsToGraphicsOffset", arr(tF32, 3)).f("mPhysicalSteeringWheelRange", tF32).f("mDeltaBest", tF64).
		f("mBatteryChargeFraction", tF64).f("mElectricBoostMotorTorque", tF64).f("mElectricBoostMotorRPM", tF64).
		f("mElectricBoostMotorTemperature", tF64).f("mElectricBoostWaterTemperature", tF64).f("mElectricBoostMotorState", tU8).
		f("mLapInvalidated", tU8).f("mABSActive", tU8).f("mTCActive", tU8).f("mSpeedLimiterActive", tU8).f("mWiperState", tU8).
		f("mTC", tU8).f("mTCMax", tU8).f("mTCSlip", tU8).f("mTCSlipMax", tU8).f("mTCCut", tU8).f("mTCCutMax", tU8).
		f("mABS", tU8).f("mABSMax", tU8).f("mMotorMap", tU8).f("mMotorMapMax", tU8).
		f("mMigration", tU8).f("mMigrationMax", tU8).
		f("mFrontAntiSway", tU8).f("mFrontAntiSwayMax", tU8).f("mRearAntiSway", tU8).f("mRearAntiSwayMax", tU8).
		f("mLiftAndCoastProgress", tU8).f("mTrackLimitsSteps", tU8).
		f("mRegen", tF32).f("mSoC", tF32).f("mVirtualEnergy", tF32).
		f("mTimeGapCarAhead", tF32).f("mTimeGapCarBehind", tF32).f("mTimeGapPlaceAhead", tF32).f("mTimeGapPlaceBehind", tF32).
		f("mVehicleModel", bytesK(30)).f("mVehicleClassEnum", tU8).f("mVehicleChampionshipEnum", tU8).
		f("mExpansion", bytesK(20)).
		f("mWheels", arr(Wheel.kind(), 4))

	VehScoring = newLayout("rF2VehicleScoring").
		f("mID", tI32).f("mDriverName", bytesK(32)).f("mVehicleName", bytesK(64)).
		f("mTotalLaps", tI16).f("mSector", tI8).f("mFinishStatus", tI8).
		f("mLapDist", tF64).f("mPathLateral", tF64).f("mTrackEdge", tF64).
		f("mBestSector1", tF64).f("mBestSector2", tF64).f("mBestLapTime", tF64).
		f("mLastSector1", tF64).f("mLastSector2", tF64).f("mLastLapTime", tF64).
		f("mCurSector1", tF64).f("mCurSector2", tF64).
		f("mNumPitstops", tI16).f("mNumPenalties", tI16).f("mIsPlayer", tU8).f("mControl", tI8).
		f("mInPits", tU8).f("mPlace", tU8).f("mVehicleClass", bytesK(32)).
		f("mTimeBehindNext", tF64).f("mLapsBehindNext", tI32).f("mTimeBehindLeader", tF64).f("mLapsBehindLeader", tI32).
		f("mLapStartET", tF64).f("mPos", tVec3).f("mLocalVel", tVec3).f("mLocalAccel", tVec3).
		f("mOri", arr(tVec3, 3)).f("mLocalRot", tVec3).f("mLocalRotAccel", tVec3).
		f("mHeadlights", tU8).f("mPitState", tU8).f("mServerScored", tU8).f("mIndividualPhase", tU8).
		f("mQualification", tI32).f("mTimeIntoLap", tF64).f("mEstimatedLapTime", tF64).
		f("mPitGroup", bytesK(24)).f("mFlag", tU8).f("mUnderYellow", tU8).f("mCountLapFlag", tU8).f("mInGarageStall", tU8).
		f("mUpgradePack", bytesK(16)).f("mPitLapDist", tF32).f("mBestLapSector1", tF32).f("mBestLapSector2", tF32).
		f("mExpansion", bytesK(48))

	ScoringInfo = newLayout("rF2ScoringInfo").
		f("mTrackName", bytesK(64)).f("mSession", tI32).f("mCurrentET", tF64).f("mEndET", tF64).
		f("mMaxLaps", tI32).f("mLapDist", tF64).f("mPointer1", bytesK(8)).f("mNumVehicles", tI32).
		f("mGamePhase", tU8).f("mYellowFlagState", tI8).f("mSectorFlag", bytesK(3)).f("mStartLight", tU8).
		f("mNumRedLights", tU8).f("mInRealtime", tU8).f("mPlayerName", bytesK(32)).f("mPlrFileName", bytesK(64)).
		f("mDarkCloud", tF64).f("mRaining", tF64).f("mAmbientTemp", tF64).f("mTrackTemp", tF64).
		f("mWind", tVec3).f("mMinPathWetness", tF64).f("mMaxPathWetness", tF64).
		f("mGameMode", tU8).f("mIsPasswordProtected", tU8).f("mServerPort", tU16).f("mServerPublicIP", tU32).
		f("mMaxPlayers", tI32).f("mServerName", bytesK(32)).f("mStartET", tF32).f("mAvgPathWetness", tF64).
		f("mSessionTimeRemaining", tF32).f("mTimeOfDay", tF32).f("mIsFixedSetup", tU8).f("mTrackGripLevel", tU8).
		f("mCloudCoverage", tU8).f("mTrackLimitsStepsPerPenalty", tU8).f("mTrackLimitsStepsPerPoint", tU8).
		f("mExpansion", bytesK(187)).f("mPointer2", bytesK(8))

	event := newLayout("LmuEvent")
	for i := 0; i < 16; i++ {
		event.f(fmt.Sprint("e", i), tU32)
	}
	app := newLayout("LmuApplicationState").f("mAppWindow", tU64).f("mWidth", tU32).f("mHeight", tU32).
		f("mRefreshRate", tU32).f("mWindowed", tU32).f("mOptionsLocation", tU8).f("mOptionsPage", bytesK(31)).
		f("mExpansion", bytesK(204))
	generic := newLayout("LmuGeneric").f("events", event.kind()).f("gameVersion", tI32).f("FFBTorque", tF32).f("appInfo", app.kind())
	paths := newLayout("LmuPathData").f("userData", bytesK(260)).f("customVariables", bytesK(260)).
		f("stewardResults", bytesK(260)).f("playerProfile", bytesK(260)).f("pluginsFolder", bytesK(260))
	scoring := newLayout("LmuScoringData").f("scoringInfo", ScoringInfo.kind()).f("scoringStreamSize", bytesK(12)).
		f("vehScoringInfo", arr(VehScoring.kind(), MaxVehicles)).f("scoringStream", bytesK(65536))
	telem := newLayout("LmuTelemetryData").f("activeVehicles", tU8).f("playerVehicleIdx", tU8).f("playerHasVehicle", tU8).
		f("telemInfo", arr(VehTelem.kind(), MaxVehicles))
	ObjectOut = newLayout("LmuObjectOut").f("generic", generic.kind()).f("paths", paths.kind()).
		f("scoring", scoring.kind()).f("telemetry", telem.kind())

	OffGameVersion = ObjectOut.o("generic") + generic.o("gameVersion")
	OffScoringInfo = ObjectOut.o("scoring") + scoring.o("scoringInfo")
	OffVehScoring = ObjectOut.o("scoring") + scoring.o("vehScoringInfo")
	OffActiveVehicles = ObjectOut.o("telemetry") + telem.o("activeVehicles")
	OffPlayerIdx = ObjectOut.o("telemetry") + telem.o("playerVehicleIdx")
	OffPlayerHasVehicle = ObjectOut.o("telemetry") + telem.o("playerHasVehicle")
	OffTelemInfo = ObjectOut.o("telemetry") + telem.o("telemInfo")

	sizes := map[string][2]int{
		"rF2Wheel": {Wheel.size(), 260}, "rF2VehicleTelemetry": {VehTelem.size(), 1888},
		"rF2VehicleScoring": {VehScoring.size(), 584}, "rF2ScoringInfo": {ScoringInfo.size(), 548},
		"LmuEvent": {event.size(), 64}, "LmuApplicationState": {app.size(), 260}, "LmuGeneric": {generic.size(), 332},
		"LmuPathData": {paths.size(), 1300}, "LmuScoringData": {scoring.size(), 126832},
		"LmuTelemetryData": {telem.size(), 196356}, "LmuObjectOut": {ObjectOut.size(), 324820},
	}
	for n, s := range sizes {
		if s[0] != s[1] {
			panic(fmt.Sprintf("layout %s: size %d, expected %d", n, s[0], s[1]))
		}
	}
	MappingSize = ObjectOut.size()
}

var (
	OffGameVersion, OffScoringInfo, OffVehScoring, OffActiveVehicles int
	OffPlayerIdx, OffPlayerHasVehicle, OffTelemInfo, MappingSize     int
)
