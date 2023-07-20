import { _decorator, Component, Node, Vec3, RichText, game, Game as ccGame, Label } from 'cc';
import { Orientation, Viewport } from '../utils/Viewport';
import * as i18n from '../../../extensions/i18n/assets/LanguageData';
import { ConfigUtils } from '../utils/ConfigUtils';
import { NetworkManager } from '../network/NetworkManager';
import { DataManager } from '../data/DataManager';
import { IStatusCommand, IProgressCommand, ICashOutCommand, IOutcomeCommand, IHistoryCommand, GameData } from '../data/GameData';
import { EventTypes } from '../events/EventTypes';
import { EventManager } from '../events/EventManager';
import { UrlParameters } from '../utils/UrlParameters';
import { GameAnimation } from '../game/GameAnimation';
import mobx from 'mobx/dist/mobx.cjs.production.min.js';
import { GameBackground, GameLevel } from '../game/GameBackground';
import { SoundState, UIMenuPanel } from '../elements/UIMenuPanel';
import { AudioStorage } from '../audio/AudioStorage';
import { AudioManager, MusicType } from '../audio/AudioManager';
import { UIPopupWindow } from '../elements/UIPopupWindow';
import { Utils } from '../utils/Utils';
import { UIGameConfig } from '../elements/UIGameConfig';
import { l10n } from '../../../extensions/localization-editor/static/assets/l10n';
const { ccclass, property } = _decorator;

console.log = () => { };

//UI初始化,預載多國語系,管理網路
@ccclass( 'Game' )
export class Game extends Component {
    //spine
    @property( { type: Node } )
    public nodeSpaceDoogy !: Node;

    //UI (bittons,slider,toggle,etc) Handler
    @property( { type: GameBackground } )
    public gameBackground !: GameBackground;
    @property( { type: UIMenuPanel } )
    public menuPanel !: UIMenuPanel;
    @property( { type: AudioStorage } )
    public audioStorage !: AudioStorage;
    @property( { type: UIPopupWindow } )
    public popupWindow !: UIPopupWindow;
    @property( { type: Node } )
    public bettingInfo !: Node;
    @property( { type: RichText } )
    public bettingFromTo !: RichText;
    @property( { type: Node } )
    public nodeCenterGameInfo !: Node;
    @property( { type: Label } )
    public centerGameInfo !: Label;

    //protectd value
    protected config: UIGameConfig;
    protected _disposer: mobx.IReactionDisposer[] = [];
    protected spaceDoggy!: GameAnimation;

    // 遊戲狀態
    protected gameStatus: string = 'standby';
    // 是否可以押注
    protected betable: boolean = false;
    // Bet 1的押注金額，0表示沒有押注
    protected bet1: number = 0;
    // Bet 2的押注金額，0表示沒有押注
    protected bet2: number = 0;
    // 最小押注
    protected min_bet: number = 1000;
    protected max_bet: number = 1000;
    protected remaining_time: number = 0;
    // 用來處理倍率變化
    protected current_multiplier: number = 0;
    protected next_multiplier: number = 0;
    protected duration: number = 0;
    protected totalDeltaTime: number = 0;
    // 是否可以自動押注
    protected isBet1AutoBet: boolean = false;
    protected isBet2AutoBet: boolean = false;

    // 已執行自動押注
    protected doAutoBet: boolean = false;
    // 是否可以自動兑獎
    protected isAutoCashOut: boolean = true;
    // 自動兑獎金額
    protected bet1AutoCashOut: number = 20.5;
    protected bet2AutoCashOut: number = 20.5;
    //是否AutoCashout
    protected isLastBet1AutoCashout: boolean = false;
    protected isLastBet2AutoCashout: boolean = false;
    // 火箭階段
    protected rocketMode: number = 1;
    protected id: number = 1;
    protected bet1CashoutWin: number = 0;
    protected bet2CashoutWin: number = 0;
    protected bet1CashoutWinMultiplier: number = 0;
    protected bet2CashoutWinMultiplier: number = 0;
    protected isUpdateGameHistoryArray: boolean = false;
    protected updateGameHistoryArrayOnce: boolean = false;
    viewport: any;
    protected isFirstProgress: boolean = true;
    protected orientation: Orientation;

    protected lastStandbyTimestamp: number = 0;
    protected showCenterGameInfo: boolean = false;
    protected isBetConfirmed: boolean = false;
    protected serverNoResponseDeltaTime: number = 0;
    protected websocketIsClosed: boolean = false;

    onLoad (): void {
        //i18n.init( UrlParameters.language );
        l10n.changeLanguage( UrlParameters.language );//在调用此方法后，会自动重启游戏，

        if ( this._disposer ) {
            this._disposer.push( mobx.autorun( () => {
                let status_command: IStatusCommand = DataManager.instance.getStatusCommand();
                if ( status_command ) {
                    //console.log( 'stage : ' + status_command.stage );
                    //console.log( 'betable : ' + status_command.betable );
                    //console.log( 'remaining_time : ' + status_command.remaining_time );
                    this.betable = status_command.betable;
                    this.gameStatus = status_command.stage;
                    if ( this.gameStatus === 'standby' ) {
                        AudioManager.instance.stopMusic( MusicType.LANDING );
                        EventManager.instance.dispatchEvent( EventTypes.GAME_STANDBY );
                        AudioManager.instance.playMusic( MusicType.MAINTAIN, { volume: 1, loop: true } );
                        //AudioManager.instance.playSound( 'M_yard', { volume: 1, loop: true } );
                    } else if ( this.gameStatus === 'ready' ) {
                        EventManager.instance.dispatchEvent( EventTypes.GAME_READY );
                    } else if ( this.gameStatus === 'play' ) {
                        AudioManager.instance.stopMusic( MusicType.MAINTAIN );
                        EventManager.instance.dispatchEvent( EventTypes.GAME_PLAY );
                        AudioManager.instance.playMusic( MusicType.FLYAWAY, { volume: 1, loop: true } );
                    } else if ( this.gameStatus === 'ending' ) {
                        AudioManager.instance.stopMusic( MusicType.FLYAWAY );
                        EventManager.instance.dispatchEvent( EventTypes.GAME_ENDING );
                        AudioManager.instance.playMusic( MusicType.LANDING, { volume: 1, loop: true } );
                    }
                    this.remaining_time = status_command.remaining_time;
                    if ( this.spaceDoggy ) {
                        this.spaceDoggy.setGameStatus( this.gameStatus );
                    }
                }
            } ) );
            this._disposer.push( mobx.autorun( () => {
                let progress_command: IProgressCommand = DataManager.instance.getProgressCommand();
                if ( progress_command ) {
                    //console.log( 'multiplier : ' + progress_command.multiplier );
                    //console.log( 'duration : ' + progress_command.duration );
                    //console.log( 'mode : ' + progress_command.mode );
                    this.duration = Number( progress_command.duration );
                    if ( this.duration > 0 ) {
                        this.current_multiplier = this.next_multiplier;
                    }
                    this.next_multiplier = Number( progress_command.multiplier );
                    this.rocketMode = Number( progress_command.mode );
                    this.gameBackground.setGameLevel( this.rocketMode );

                    if ( this.isFirstProgress && this.spaceDoggy ) {
                        this.spaceDoggy.jumpToRocket();
                        //this.gameInfoPanel.playGame();
                        this.isFirstProgress = false;
                        //EventManager.instance.dispatchEvent( EventTypes.ALLOW_CASHOUT );
                    }
                }
            } ) );
            this._disposer.push( mobx.autorun( () => {
                let cash_out_command: ICashOutCommand = DataManager.instance.getCashOutCommand();
                if ( cash_out_command ) {
                    //console.log( 'outcome.id :~~~~ ' + cash_out_command.outcome.id );
                    //console.log( 'outcome.bet :~~~~ ' + cash_out_command.outcome.bet );
                    //console.log( 'outcome.win :~~~~ ' + cash_out_command.outcome.win );
                    //console.log( 'outcome.multiplier : ' + cash_out_command.outcome.multiplier );
                    //console.log( 'change_credit : ' + cash_out_command.change_credit );
                    //console.log( 'credit : ' + cash_out_command.credit );
                    if ( cash_out_command.outcome.id === 1 ) {
                        this.bet1CashoutWin = cash_out_command.outcome.win;
                        this.bet1CashoutWinMultiplier = Number( cash_out_command.outcome.multiplier );
                        // 當進行中的倍率顯示到跟AutoCashOut的倍率一樣時再打開中獎視窗
                        //EventManager.instance.dispatchEvent( EventTypes.BET1_CASHOUT, cash_out_command.outcome.win );
                    } else if ( cash_out_command.outcome.id === 2 ) {
                        this.bet2CashoutWin = cash_out_command.outcome.win;
                        this.bet2CashoutWinMultiplier = Number( cash_out_command.outcome.multiplier );
                        // 當進行中的倍率顯示到跟AutoCashOut的倍率一樣時再打開中獎視窗
                        //EventManager.instance.dispatchEvent( EventTypes.BET2_CASHOUT, cash_out_command.outcome.win );
                    }
                }
            } ) );
            this._disposer.push( mobx.autorun( () => {
                let outcome_command: IOutcomeCommand = DataManager.instance.getOutcomeCommand();
                if ( outcome_command ) {
                    //console.log( 'outcome_command.result : ' + outcome_command.result );
                    for ( let i = 0; i < outcome_command.outcomes.length; i++ ) {
                        //console.log( 'outcome_command.outcome.id : ' + outcome_command.outcomes[ i ].id );
                        //console.log( 'outcome_command.outcome.bet : ' + outcome_command.outcomes[ i ].bet );
                        //console.log( 'outcome_command.outcome.win~~~~ : ' + outcome_command.outcomes[ i ].win );
                        //console.log( 'outcome_command.outcome.multiplier : ' + outcome_command.outcomes[ i ].multiplier );
                        if ( outcome_command.outcomes[ i ].id === 1 ) {
                            this.bet1CashoutWin = outcome_command.outcomes[ i ].win;
                        } else if ( outcome_command.outcomes[ i ].id === 2 ) {
                            this.bet2CashoutWin = outcome_command.outcomes[ i ].win;
                        }
                    }
                    /*
                    console.log( 'outcome_command.effect_credit : ' + outcome_command.effect_credit );
                    console.log( 'outcome_command.payout_credit : ' + outcome_command.payout_credit );
                    console.log( 'outcome_command.change_credit : ' + outcome_command.change_credit );
                    console.log( 'outcome_command.credit : ' + outcome_command.credit );*/
                    //有cashout或autocashout的話會在onBetXCashout()處理

                }
            } ) );
            this._disposer.push( mobx.autorun( () => {
                let history_command: IHistoryCommand = DataManager.instance.getHistoryCommand();
                if ( history_command ) {
                    if ( history_command.data !== undefined ) {
                        //for ( let i = 0; i < history_command.data.length; i++ ) {
                        //    console.log( 'data[' + i + '] : ' + history_command.data[ i ] );
                        //}

                    }
                }
            } ) );
        }

        DataManager.instance.onCreditChange.add( this.onCreditChange.bind( this ) );
        DataManager.instance.onJoinServer.add( this.onJoinServer.bind( this ) );
        EventManager.instance.addListener( this, EventTypes.GAME_STANDBY, this.onGameStandby.bind( this ) );
        EventManager.instance.addListener( this, EventTypes.GAME_READY, this.onGameReady.bind( this ) );
        EventManager.instance.addListener( this, EventTypes.GAME_PLAY, this.onGamePlay.bind( this ) );
        EventManager.instance.addListener( this, EventTypes.GAME_ENDING, this.onGameEnding.bind( this ) );
        EventManager.instance.addListener( this, EventTypes.BET_CONFIRMED, this.onBetConfirmed.bind( this ) );
        EventManager.instance.addListener( this, EventTypes.BET1_CASHOUT, this.onBet1CashOut.bind( this ) );
        EventManager.instance.addListener( this, EventTypes.BET2_CASHOUT, this.onBet2CashOut.bind( this ) );
        EventManager.instance.addListener( this, EventTypes.ALLOW_CASHOUT, this.onAllowCashOut.bind( this ) );
        EventManager.instance.addListener( this, EventTypes.SHOW_RESPONSE_MESSAGE, this.onShowResponseMessage.bind( this ) );
        EventManager.instance.addListener( this, EventTypes.SHOW_TOTAL_WIN, this.onShowTotalWin.bind( this ) );

        game.on( ccGame.EVENT_HIDE, this.onHide, this );
        game.on( ccGame.EVENT_SHOW, this.onShow, this );
    }
    start () {
        if ( !this.spaceDoggy ) {
            this.spaceDoggy = this.getComponentInChildren<GameAnimation>( GameAnimation );
        }

        Viewport.instance.onOrientationChangeSignal.add( ( orientation: Orientation ) => {
            this.onOrientationChange( orientation );
        } );

        this.config = ConfigUtils.getConfig<UIGameConfig>( UIGameConfig );
        this.onOrientationChange( Viewport.instance.getCurrentOrientation() );

        if ( this.audioStorage ) {
            AudioManager.instance.setAudioStorage( this.audioStorage );
        }

        if ( !this.gameBackground ) {
            this.gameBackground = this.getComponentInChildren<GameBackground>( GameBackground );
        }
        if ( !this.menuPanel ) {
            this.menuPanel = this.getComponentInChildren<UIMenuPanel>( UIMenuPanel );
        }
        //this.menuPanel.resetSound( SoundState.MUSIC_MUTED );
        /*
        if ( !this.popupWindow ) {
            this.popupWindow = this.getComponentInChildren<UIPopupWindow>( UIPopupWindow );
        }
        
        if ( !this.bettingInfo ) {
            this.bettingInfo = this.node.getChildByName( "BettingInfo" );
        }
        if ( !this.bettingFromTo ) {
            this.bettingFromTo = this.bettingInfo.getComponent<RichText>( RichText );
        }
        if ( !this.nodeCenterGameInfo ) {
            this.nodeCenterGameInfo = this.node.getChildByName( "CenterGameInfo" );
        }
        this.nodeCenterGameInfo.active = false;
        if ( !this.centerGameInfo ) {
            this.centerGameInfo = this.nodeCenterGameInfo.getComponent<Label>( Label );
        }
        */
        EventManager.instance.addListener( this, EventTypes.WEBSOCKET_OPEN, this.onWebsocketOpen );
        EventManager.instance.addListener( this, EventTypes.WEBSOCKET_CLOSE, this.onWebsocketClose );
        EventManager.instance.addListener( this, EventTypes.WEBSOCKET_ERROR, this.onWebsocketError );
        EventManager.instance.addListener( this, EventTypes.WEBSOCKET_MESSAGE_RECEIVED, this.onWebsocketMessageReceived );

        this.connectToServer()
            .catch( function () {
            } );
    }
    onDestroy (): void {
        Viewport.instance.onOrientationChangeSignal.remove( ( orientation: Orientation ) => {
            this.onOrientationChange( orientation );
        } );
    }
    protected update ( dt: number ): void {
        if ( this.gameStatus === 'play' ) {
            let currentMultiplier = 0;

            if ( this.bet1CashoutWinMultiplier > 0 && currentMultiplier >= this.bet1CashoutWinMultiplier ) {
                this.bet1CashoutWinMultiplier = 0;
                EventManager.instance.dispatchEvent( EventTypes.BET1_CASHOUT, this.bet1CashoutWin );
            }
            if ( this.bet2CashoutWinMultiplier > 0 && currentMultiplier >= this.bet2CashoutWinMultiplier ) {
                this.bet2CashoutWinMultiplier = 0;
                EventManager.instance.dispatchEvent( EventTypes.BET2_CASHOUT, this.bet2CashoutWin );
            }
        }
        this.serverNoResponseDeltaTime += dt;
        if ( this.serverNoResponseDeltaTime > 60 ) {
            if ( !this.websocketIsClosed ) {
                //let reason: string = i18n.t( 'game_error_3' );
                let reason: string = l10n.t( 'game_error_3' );
                NetworkManager.instance.close( 1000, reason );
                this.websocketIsClosed = true;
            } else {
                let script: UIPopupWindow = this.popupWindow.getComponent( UIPopupWindow );
                script.setMessage( 4 );
                script.open();
            }
            this.serverNoResponseDeltaTime = 0;
        }
    }
    onHide () {
        //console.log( 'onHide~~~~' + Date.now() );
    }
    onShow () {
        if ( this.gameStatus === 'standby' ) {
            EventManager.instance.dispatchEvent( EventTypes.GAME_STANDBY );
        } else if ( this.gameStatus === 'play' ) {
            EventManager.instance.dispatchEvent( EventTypes.GAME_PLAY );
        } else if ( this.gameStatus === 'ending' ) {
            EventManager.instance.dispatchEvent( EventTypes.GAME_ENDING );
        }
    }
    /***
    * implements IOrientable
    */
    onOrientationChange ( orientation: Orientation ): void {
        console.log( 'orientation : ' + orientation );
        if ( orientation === Orientation.LADNSCAPE ) {
            this.landscapeLayout();
        }
        else {
            this.portraitLayout();
        }
        this.orientation = orientation;
        this.setBettingInfo();
    }
    landscapeLayout (): void {
        //let scale: Vec3 = this.config.scaleSpaceDoogy.get( Orientation.LADNSCAPE );
        //this.nodeSpaceDoogy.setScale( scale );
        //this.spaceDoggy.setCharacterAndRocketScale( scale );
        //let position: Vec3 = this.config.nodeSpaceDoogy.get( Orientation.LADNSCAPE );
        //this.nodeSpaceDoogy.setPosition( position );
        //this.nodeCenterGameInfo.position.set( 0, -22, 0 );

    }
    portraitLayout (): void {
        //let scale: Vec3 = this.config.scaleSpaceDoogy.get( Orientation.PORTRAIT );
        //this.nodeSpaceDoogy.setScale( scale );
        //this.spaceDoggy.setCharacterAndRocketScale( scale );
        //let position: Vec3 = this.config.nodeSpaceDoogy.get( Orientation.PORTRAIT );
        //this.nodeSpaceDoogy.setPosition( position );
        //this.nodeCenterGameInfo.position.set( 0, 42, 0 );
    }

    setBettingInfo () {
        /*
        let bettingString1: string = i18n.t( 'betting_from_to_1' );
        let bettingString2: string = i18n.t( 'betting_from_to_2' );
        bettingString1 += ' ' + '<color=#9c81ff>' + Utils.changeUnit( this.min_bet, true ) + '</color> ';
        bettingString1 += bettingString2;
        bettingString1 += ' ' + '<color=#9c81ff>' + Utils.changeUnit( this.max_bet, true ) + '</color> ';
        if ( this.orientation === Orientation.LADNSCAPE ) {
            bettingString1 = '<b><size=25>' + bettingString1 + '</size></b>'
            if ( this.bettingFromTo ) {
                this.bettingFromTo.string = bettingString1;
            }
            if ( this.bettingInfo ) {
                this.bettingInfo.position.set( 0, -355, 0 );
            }
        } else {
            bettingString1 = '<b><size=20>' + bettingString1 + '</size></b>'
            if ( this.bettingFromTo ) {
                this.bettingFromTo.string = bettingString1;
            }
            if ( this.bettingInfo ) {
                this.bettingInfo.position.set( -210, 529, 0 );
            }
        }*/
    }

    async connectToServer () {
        NetworkManager.instance.connect( UrlParameters.ws );
    }

    onWebsocketOpen () {
        const command: any = {
            command: 'join',
            data: {
                token: UrlParameters.token
            }
        };

        NetworkManager.instance.sendMessage( JSON.stringify( command ) );
    }

    onWebsocketClose () {
        let script: UIPopupWindow = this.popupWindow.getComponent( UIPopupWindow );
        script.setMessage( 4 );
        script.open();
    }

    onWebsocketError () {
        let script: UIPopupWindow = this.popupWindow.getComponent( UIPopupWindow );
        script.setMessage( 3 );
        script.open();
    }

    onWebsocketMessageReceived () {
        this.serverNoResponseDeltaTime = 0;
    }

    onCreditChange ( userCredit: number ) {



    }

    onJoinServer () {
        let gameData: GameData = DataManager.instance.gameData;
        let min_bet: number = gameData.min_bet;
        this.min_bet = min_bet;
        let max_bet: number = gameData.max_bet;
        this.max_bet = max_bet;
        let currency: string = gameData.currency;
        console.log( 'Join server =' + max_bet + ',' + min_bet );

        this.updateGameResult( 100 );
        this.setBettingInfo();
    }

    onGameStandby () {
        this.gameBackground.setGameLevel( GameLevel.LEVEL_1 );
        let bet1Result: boolean = false;
        let bet2Result: boolean = false;
        if ( this.isBet1AutoBet ) {
            bet1Result = this.bet1CommandBet( true );
        }
        if ( this.isBet2AutoBet ) {
            bet2Result = this.bet2CommandBet( true );
        }


        let status_command: IStatusCommand = DataManager.instance.getStatusCommand();
        let remainingTime: number = 20;//倒數計時,剩餘時間
        if ( status_command ) {
            remainingTime = status_command.remaining_time;
        }
        let elapsedRemainTime: number = 0;//經過的剩餘的時間
        let deltaTime: number = Date.now() - this.lastStandbyTimestamp;//經過時間差
        //console.log( 'gameStandby~~~~Date.now()=' + Date.now() + ',timestamp' + this.lastStandbyTimestamp );
        if ( deltaTime >= remainingTime * 1000 ) {//millisecond
            //do next round
            this.lastStandbyTimestamp = Date.now();
            elapsedRemainTime = remainingTime * 1000;
        }
        else {
            //same round , duration elapsed time"
            elapsedRemainTime = remainingTime * 1000 - deltaTime;//millisecond
        }

        //console.log( 'gameStandby~~~~remainingTime=' + remainingTime + ',deltaTime=' + deltaTime + ',timestamp' + this.lastStandbyTimestamp + ',elapsedTime=' + elapsedRemainTime );
        this.current_multiplier = 1.00;
        this.next_multiplier = 1.00;
        this.isFirstProgress = true;
        this.bet1CashoutWin = 0;
        this.bet2CashoutWin = 0;
        this.bet1CashoutWinMultiplier = 0;
        this.bet1CashoutWinMultiplier = 0;
        this.showCenterGameInfo = true;
    }

    onGameReady () {
        if ( this.showCenterGameInfo ) {
            this.nodeCenterGameInfo.active = true;
            let centerGameInfo: string = '';
            if ( this.isBetConfirmed ) {
                centerGameInfo = i18n.t( 'center_game_information_2' );
            } else {
                centerGameInfo = i18n.t( 'center_game_information_1' );
            }
            this.centerGameInfo.string = centerGameInfo;
        }

    }

    onGamePlay () {

    }

    onGameEnding () {

        this.gameBackground.setGameLevel( GameLevel.LEVEL_5 );
        //this.gameInfoPanel.gameEnding( this.current_multiplier, this.bet1CashoutWin + this.bet2CashoutWin );
        if ( this.showCenterGameInfo ) {
            this.showCenterGameInfo = false;
            this.nodeCenterGameInfo.active = false;
            this.isBetConfirmed = false;
        }
    }

    onBetConfirmed () {
        if ( this.showCenterGameInfo ) {
            this.nodeCenterGameInfo.active = true;
            let centerGameInfo: string = i18n.t( 'center_game_information_2' );
            this.centerGameInfo.string = centerGameInfo;
            this.isBetConfirmed = true;
        }
    }

    onBet1CashOut () {

    }

    onBet2CashOut () {

    }

    //UI
    public onBet1ButtonConfirm (): void {

    }

    public onBet1ButtonCancel (): void {

    }

    public onBet1ButtonCashout (): void {
        this.id = 1;
        const command: any = {
            command: 'cashout',
            data: {
                id: this.id,
            }
        };

        NetworkManager.instance.sendMessage( JSON.stringify( command ) );
        //console.log( 'onBet1Cashout Button:~~~~ ' + this.betPanel.getBetValue( ToggleBetType.BET1 ) );
    }

    public onBet1ButtonRebet (): void {

    }
    public onBet1ToggleAutoRebetChange (): void {

    }

    public onBet1ToggleAutoCashoutChange (): void {

    }

    public onBet2ButtonConfirm (): void {

    }

    public onBet2ButtonCancel (): void {

    }

    public onBet2ButtonCashout (): void {

    }

    public onBet2ButtonRebet (): void {

    }

    public onBet2ToggleAutoRebetChange (): void {

    }

    public onBet2ToggleAutoCashoutChange (): void {

    }

    public bet1CommandBet ( isRebet: boolean = false ): boolean {

        return true;
    }

    public bet2CommandBet ( isRebet: boolean = false ): boolean {

        return true
    }

    public updateGameResult ( value: number ): void {
        const command: any = {
            command: 'history',
            data: {
                count: value
            }
        };

        NetworkManager.instance.sendMessage( JSON.stringify( command ) );
    }

    public onButtonGameResultMore (): void {
        this.isUpdateGameHistoryArray = true;
    }

    public onAllowCashOut () {

    }

    public onShowResponseMessage ( message: string ) {
        let script: UIPopupWindow = this.popupWindow.getComponent( UIPopupWindow );
        script.setResponseMessage( message );
        script.open();
    }

    public onShowTotalWin () {

    }

    public testEn (): void {
        l10n.changeLanguage( 'en' );//在调用此方法后，会自动重启游戏，
    }

    public testId (): void {
        l10n.changeLanguage( 'id' );//在调用此方法后，会自动重启游戏，
    }
}

