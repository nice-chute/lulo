import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { Lulo } from '../target/types/lulo';
import {
  PublicKey, Keypair, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL,
  SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
  SYSVAR_RENT_PUBKEY
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, Token, NATIVE_MINT, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";

describe('lulo', () => {

  // Wallets
  let vaultAuth = Keypair.generate();
  let luloAuth = Keypair.generate();

  // Accounts
  let vault = Keypair.generate();
  let positions: Keypair = Keypair.generate();
  let branchMintAcc = Keypair.generate();
  let recipient = Keypair.generate();
  let usdcRecipient = Keypair.generate();
  let recipientAcc = null;
  let controllerMint = null;
  let usdcAcc = null;

  // PDAs
  let state = null;
  let payMint = null;
  let branch = null;
  let branchMint = null;
  let controller = null;

  // Bumps
  let stateBump = null;
  let payMintBump = null;
  let branchBump = null;
  let branchMintBump = null;
  let controllerBump = null;

  // Params and BNs
  const zero = new anchor.BN(0);
  const amount = new anchor.BN(100);

  // Testing vars
  let numBranches = 0;
  let testBalance = 0;

  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());
  const provider = anchor.Provider.env();
  const program = anchor.workspace.Lulo as Program<Lulo>;

  it('Initialize state', async () => {
    // Airdrop vaultAuth
    const vaultAuthAirdrop = await provider.connection.requestAirdrop(vaultAuth.publicKey, 100 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(vaultAuthAirdrop);
    // Airdrop luloAuth
    const luloAuthAirdrop = await provider.connection.requestAirdrop(luloAuth.publicKey, 100 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(luloAuthAirdrop);
    // Airdrop recipient
    const recipientAirdrop = await provider.connection.requestAirdrop(recipient.publicKey, 100 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(recipientAirdrop);
    // Airdrop usdc recipient
    const usdcRecipientAirdrop = await provider.connection.requestAirdrop(usdcRecipient.publicKey, 100 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(usdcRecipientAirdrop);

    // Controller mint
    controllerMint = await Token.createMint(
      provider.connection,
      luloAuth,
      luloAuth.publicKey,
      null,
      6,
      TOKEN_PROGRAM_ID
    );

    // State PDA
    [state, stateBump] = await PublicKey.findProgramAddress(
      [
        Buffer.from(anchor.utils.bytes.utf8.encode("lulo")),
      ],
      program.programId
    );
    // Pay mint PDA
    [payMint, payMintBump] = await PublicKey.findProgramAddress(
      [
        Buffer.from(anchor.utils.bytes.utf8.encode("pay_mint")),
      ],
      program.programId
    );
    // Branch PDA
    [branch, branchBump] = await PublicKey.findProgramAddress(
      [
        Buffer.from(anchor.utils.bytes.utf8.encode("branch")),
        vault.publicKey.toBuffer(),
      ],
      program.programId
    );
    // Branch Mint PDA
    [branchMint, branchMintBump] = await PublicKey.findProgramAddress(
      [
        Buffer.from(anchor.utils.bytes.utf8.encode("mint")),
        branch.toBuffer(),
      ],
      program.programId
    );
    // Controller PDA
    [controller, controllerBump] = await PublicKey.findProgramAddress(
      [
        Buffer.from(anchor.utils.bytes.utf8.encode("controller")),
        controllerMint.publicKey.toBuffer(),
      ],
      program.programId
    );

    // calculate recipient ATA
    recipientAcc = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID, // always ASSOCIATED_TOKEN_PROGRAM_ID
      TOKEN_PROGRAM_ID, // always TOKEN_PROGRAM_ID
      payMint, // mint
      recipient.publicKey // owner
    );

    let tx = new Transaction().add(
      Token.createAssociatedTokenAccountInstruction(
        ASSOCIATED_TOKEN_PROGRAM_ID, // always ASSOCIATED_TOKEN_PROGRAM_ID
        TOKEN_PROGRAM_ID, // always TOKEN_PROGRAM_ID
        payMint, // mint
        recipientAcc, // ata
        recipient.publicKey, // owner of token account
        recipient.publicKey // fee payer
      )
    );
    await provider.connection.sendTransaction(tx, [recipient])
  });

  it('Initialize program', async () => {
    const tx = await program.rpc.initialize(
      {
        accounts: {
          signer: luloAuth.publicKey,
          state: state,
          mint: payMint,
          controller: controller,
          controllerMint: controllerMint.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY
        },
        signers: [luloAuth]
      });
    // Pay mint initialized correctly
    let _mint = await provider.connection.getParsedAccountInfo(payMint)
    assert.ok(_mint.value.data['parsed']['info']['mintAuthority'] == payMint)
    //assert.ok(_mint.value.data['parsed']['info']['supply'] == '0')
    assert.ok(_mint.value.data['parsed']['type'] == 'mint')
    // State initialized correctly
    let _state = await program.account.state.fetch(state);
    assert.ok(_state.payMint.equals(payMint))
    assert.ok(_state.admin.equals(luloAuth.publicKey))
    // Controller created
    let _controller = await provider.connection.getParsedAccountInfo(controller)
    assert.ok(_controller.value.data['parsed']['info']['mint'] == controllerMint.publicKey.toBase58())
    // Mint usdc to controller
    await controllerMint.mintTo(
      controller,
      luloAuth.publicKey,
      [luloAuth],
      100000
    );
    // calculate recipient ATA
    usdcAcc = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID, // always ASSOCIATED_TOKEN_PROGRAM_ID
      TOKEN_PROGRAM_ID, // always TOKEN_PROGRAM_ID
      controllerMint.publicKey, // mint
      usdcRecipient.publicKey // owner
    );

    let tx1 = new Transaction().add(
      Token.createAssociatedTokenAccountInstruction(
        ASSOCIATED_TOKEN_PROGRAM_ID, // always ASSOCIATED_TOKEN_PROGRAM_ID
        TOKEN_PROGRAM_ID, // always TOKEN_PROGRAM_ID
        controllerMint.publicKey, // mint
        usdcAcc, // ata
        usdcRecipient.publicKey, // owner of token account
        usdcRecipient.publicKey // fee payer
      )
    );
    await provider.connection.sendTransaction(tx1, [usdcRecipient])
  });

  it('Open Vault', async () => {
    const tx = await program.rpc.openVault(
      {
        accounts: {
          signer: vaultAuth.publicKey,
          vault: vault.publicKey,
          positions: positions.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY
        },
        instructions: [],
        signers: [vaultAuth, vault, positions]
      });

    // Vault initialized correctly
    let _vault = await program.account.vault.fetch(vault.publicKey);
    assert.ok(_vault.admin.equals(vaultAuth.publicKey))
    assert.ok(_vault.balance.eq(zero))
    assert.ok(_vault.activeBranches.eq(zero))
    let _positions: any = _vault.positions;
    assert.ok(_positions.equals(positions.publicKey))

    // Positions initialized correctly
    _positions = await program.account.positions.fetch(positions.publicKey);
    assert.ok(_positions.vault.equals(vault.publicKey))

    // For testing later
    numBranches = 0
  });

  it('Open Branch', async () => {
    const tx = await program.rpc.openBranch(
      {
        accounts: {
          signer: vaultAuth.publicKey,
          vault: vault.publicKey,
          branch: branch,
          mint: branchMint,
          mintAccount: branchMintAcc.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY
        },
        instructions: [],
        signers: [vaultAuth, branchMintAcc]
      });

    // Branch initialized correctly
    let _branch = await program.account.branch.fetch(branch);
    assert.ok(_branch.vault.equals(vault.publicKey))
    assert.ok(_branch.mint.equals(branchMint))
    assert.ok(_branch.balance.eq(zero))
    // Vault metadata updated
    let _vault = await program.account.vault.fetch(vault.publicKey);
    assert.ok(_vault.activeBranches.toNumber() == numBranches + 1)
    // Received Branch NFT
    let _acc = await provider.connection.getParsedAccountInfo(branchMintAcc.publicKey);
    assert.ok(_acc.value.data['parsed']['info']['mint'] == branchMint.toBase58())
    assert.ok(_acc.value.data['parsed']['info']['tokenAmount']['uiAmount'] == 1)
    assert.ok(_acc.value.data['parsed']['info']['owner'] == vaultAuth.publicKey)
  });

  it('Pay', async () => {
    const tx = await program.rpc.pay(
      amount,
      {
        accounts: {
          signer: vaultAuth.publicKey,
          payMint: payMint,
          vault: vault.publicKey,
          branch: branch,
          branchNft: branchMintAcc.publicKey,
          recipient: recipientAcc,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        instructions: [],
        signers: [vaultAuth]
      });

    // Vault metadata updated
    let _vault = await program.account.vault.fetch(vault.publicKey);
    assert.ok(_vault.balance.eq(amount))
    // Branch metadata updated
    let _branch = await program.account.branch.fetch(branch);
    assert.ok(_branch.balance.eq(amount))
    // Recipient received funds
    let _balance = await provider.connection.getTokenAccountBalance(recipientAcc)
    assert.ok(_balance.value.amount == amount.toString())
    // Testing var
    testBalance = amount.toNumber()

  });
  it('Swap iUSDC for USDC', async () => {
    const tx = await program.rpc.swap(
      amount,
      {
        accounts: {
          signer: recipient.publicKey,
          payMint: payMint,
          controllerMint: controllerMint.publicKey,
          controller: controller,
          settle: recipientAcc,
          recipient: usdcAcc,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        instructions: [],
        signers: [recipient]
      });
    // USDC transferred to recipient
    let _usdc = await provider.connection.getTokenAccountBalance(usdcAcc)
    assert.ok(_usdc.value.amount == amount.toString())
    // iUSDC burnt
    let _iusdc = await provider.connection.getTokenAccountBalance(recipientAcc)
    assert.ok(_iusdc.value.amount == (testBalance - amount.toNumber()).toString())
  });

  it('Close branch', async () => {
    const tx = await program.rpc.closeBranch(
      {
        accounts: {
          signer: vaultAuth.publicKey,
          vault: vault.publicKey,
          branch: branch,
          mint: branchMint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        instructions: [],
        signers: [vaultAuth]
      });
  });
});
